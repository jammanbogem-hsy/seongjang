import { FIREBASE_CALLABLES } from './auth'
import { assembleFirebaseSnapshot } from './assemble'
import {
  createFirebaseSdkDriver,
  type FirebaseBackendDriver,
  type FirebaseCollectionSnapshotRecord,
  type FirebaseDocumentRecord,
  type FirebaseDocumentSnapshotRecord,
  type FirebaseSnapshotMetadata,
} from './driver'
import type {
  CreateFirebaseBackendOptions,
  FirebaseAuthoritativeCommand,
  FirebaseBackend,
  FirebaseBackendSnapshot,
  FirebaseCommandSuccess,
  FirebaseDraftStatus,
  FirebaseDraftWrite,
  FirebaseEntityBundle,
  SaveAnswerDraftRequest,
  SavePrivateDraftRequest,
  SaveProjectDraftRequest,
  SaveSynthesisDraftRequest,
} from './types'

const DEVICE_ID_STORAGE_KEY = 'vibecoding.device-id.v1'

function createDeviceId(): string {
  return `web-${typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
}

function stableDeviceId(): string {
  if (typeof window === 'undefined') return createDeviceId()
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY)
    if (existing && /^web-[A-Za-z0-9-]{12,180}$/.test(existing)) return existing
    const created = createDeviceId()
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, created)
    return created
  } catch {
    return createDeviceId()
  }
}

const DEVICE_ID = stableDeviceId()

type CollectionKey =
  | 'adminInvites'
  | 'answerDrafts'
  | 'answers'
  | 'comments'
  | 'participants'
  | 'projectDrafts'
  | 'reviewThreads'
  | 'slides'
  | 'submissions'
  | 'themes'

type PublicShardKey = 'answers' | 'comments' | 'projects' | 'stages' | 'themes'

const PUBLIC_SHARD_KEYS: PublicShardKey[] = ['stages', 'answers', 'comments', 'projects', 'themes']

// These limits mirror the product's server-enforced 100-person event model.
// They keep a malformed collection or replayed client from turning one screen
// subscription into an unbounded Firestore read bill.
const LISTENER_LIMITS = {
  adminInvites: 50,
  answerDrafts: 400,
  answers: 400,
  comments: 1_200,
  participants: 100,
  projectDrafts: 100,
  projects: 100,
  reviewMessages: 50,
  reviewThreads: 300,
  slides: 12,
  submissions: 100,
  themes: 32,
} as const

function publicShardLimit(key: PublicShardKey): number {
  if (key === 'stages') return LISTENER_LIMITS.slides
  if (key === 'answers') return LISTENER_LIMITS.answers
  if (key === 'comments') return LISTENER_LIMITS.comments
  if (key === 'projects') return LISTENER_LIMITS.projects
  return LISTENER_LIMITS.themes
}

function emptyBundle(): FirebaseEntityBundle {
  return {
    adminInvites: [],
    answerDrafts: [],
    answers: [],
    comments: [],
    event: null,
    live: null,
    participants: [],
    projectDrafts: [],
    publishedSnapshot: null,
    reviewThreads: [],
    slides: [],
    submissions: [],
    synthesis: null,
    themes: [],
  }
}

function mutationId(prefix: string): string {
  const suffix = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${suffix}`
}

function safeDocumentSegment(value: string): string {
  return value.trim().replaceAll('/', '_')
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function asText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function timestampIso(value: unknown, fallback = new Date(0).toISOString()): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string' || typeof value === 'number') {
    const candidate = new Date(value)
    if (!Number.isNaN(candidate.getTime())) return candidate.toISOString()
  }
  if (value && typeof value === 'object' && 'toDate' in value) {
    const toDate = (value as { toDate?: unknown }).toDate
    if (typeof toDate === 'function') {
      const candidate = toDate.call(value)
      if (candidate instanceof Date) return candidate.toISOString()
    }
  }
  return fallback
}

function buildPublishedSnapshot(
  publicRoot: FirebaseDocumentRecord,
  revision: FirebaseDocumentRecord,
  shards: Record<PublicShardKey, FirebaseDocumentRecord[]>,
): FirebaseDocumentRecord {
  const join = asObject(publicRoot.data.join)
  const room = asObject(join.room)
  const revisionData = revision.data
  const commentsByAnswer = new Map<string, Array<Record<string, unknown>>>()
  shards.comments.forEach((record) => {
    const data = record.data
    const answerId = asText(data.answerId)
    const comments = commentsByAnswer.get(answerId) ?? []
    comments.push({
      author: { name: asText(data.authorName, '참여자') },
      body: asText(data.body),
      createdAt: timestampIso(data.createdAt ?? revisionData.publishedAt),
    })
    commentsByAnswer.set(answerId, comments)
  })
  const answers = shards.answers.map((record) => {
    const data = record.data
    const key = asText(data.id, record.id)
    return {
      key,
      stageId: asText(data.stageId ?? data.slideId),
      author: { name: asText(data.authorName, '참여자') },
      content: asText(data.content),
      submittedAt: timestampIso(data.submittedAt ?? revisionData.publishedAt),
      comments: commentsByAnswer.get(key) ?? [],
    }
  })
  const stages = shards.stages
    .map((record) => {
      const data = record.data
      const key = asText(data.id, record.id)
      return {
        key,
        order: asNumber(data.order),
        eyebrow: asText(data.eyebrow),
        title: asText(data.title),
        prompt: asText(data.prompt),
        answers: answers
          .filter((answer) => answer.stageId === key)
          .map((answer) => ({
            key: answer.key,
            author: answer.author,
            content: answer.content,
            submittedAt: answer.submittedAt,
            comments: answer.comments,
          })),
      }
    })
    .sort((left, right) => left.order - right.order)
  const publicAnswers = answers.map((answer) => ({
    key: answer.key,
    author: answer.author,
    content: answer.content,
    submittedAt: answer.submittedAt,
    comments: answer.comments,
  }))
  const highlightKeys = Array.isArray(revisionData.highlightAnswerKeys)
    ? revisionData.highlightAnswerKeys.filter((value): value is string => typeof value === 'string')
    : []
  const highlights = highlightKeys.length
    ? publicAnswers.filter((answer) => highlightKeys.includes(answer.key))
    : publicAnswers.slice(0, 4)
  const projects = shards.projects.map((record) => {
    const data = record.data
    return {
      key: asText(data.id, record.id),
      maker: { name: asText(data.authorName, '참여자') },
      title: asText(data.title),
      pitch: asText(data.pitch),
      description: asText(data.description),
      demoUrl: asText(data.demoUrl),
      githubUrl: asText(data.githubUrl),
      tags: Array.isArray(data.tags)
        ? data.tags.filter((value): value is string => typeof value === 'string')
        : [],
      retrospective: asText(data.retrospective),
      coverImage: asText(data.coverImage, '/assets/illustrations/cat-submission.webp'),
      submittedAt: timestampIso(data.submittedAt ?? revisionData.publishedAt),
    }
  })
  const themes = shards.themes.map((record) => {
    const data = record.data
    return {
      label: asText(data.label),
      description: asText(data.description),
      color: asText(data.color, '#3157C8'),
      answerCount: asNumber(data.answerCount),
      excerpts: Array.isArray(data.excerpts)
        ? data.excerpts.filter((value): value is string => typeof value === 'string')
        : [],
    }
  })
  return {
    id: revision.id,
    data: {
      ...revisionData,
      data: {
        title: asText(revisionData.title ?? publicRoot.data.title),
        tagline: asText(revisionData.tagline ?? publicRoot.data.tagline),
        organizerName: asText(revisionData.organizerName ?? room.organizerName),
        eventDate: asText(revisionData.eventDate ?? room.eventDate),
        roomCode: asText(room.code),
        capacity: asNumber(room.capacity, 100),
        summary: asText(revisionData.summary),
        nicknamePolicy: revisionData.nicknamePolicy === 'anonymous' ? 'anonymous' : 'nickname',
        metrics: asObject(revisionData.metrics),
        stages,
        themes,
        highlights,
        exhibitionPublished: publicRoot.data.exhibitionPublished === true &&
          revisionData.exhibitionPublished === true,
        projects,
      },
    },
  }
}

function errorFromUnknown(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error('Firebase 요청을 완료하지 못했습니다.')
}

interface CallableEnvelope<T> {
  error?: { code?: string; message?: string }
  notice?: string
  ok?: boolean
  operationId?: string
  result?: CallableEnvelope<T>
  value?: T
}

function commandResult<T>(raw: unknown): FirebaseCommandSuccess<T> {
  const envelope = raw && typeof raw === 'object' ? raw as CallableEnvelope<T> : {}
  const candidate = envelope.result && typeof envelope.result === 'object' ? envelope.result : envelope
  if (candidate.ok === false || candidate.error) {
    throw new Error(candidate.error?.message ?? '서버에서 요청을 거절했습니다.')
  }
  return {
    notice: candidate.notice,
    operationId: candidate.operationId,
    value: Object.prototype.hasOwnProperty.call(candidate, 'value')
      ? candidate.value as T
      : raw as T,
  }
}

function reviewCommand(command: FirebaseAuthoritativeCommand): boolean {
  return command.type === 'ADD_REVIEW_THREAD' ||
    command.type === 'ADD_REVIEW_REPLY' ||
    command.type === 'SET_REVIEW_THREAD_STATUS'
}

export class FirebaseEventBackend implements FirebaseBackend {
  private readonly confirmedDraftRevisions = new Map<string, number>()
  private readonly driver: FirebaseBackendDriver
  private readonly eventId: string
  private readonly includePublishedSnapshot: boolean
  private readonly participantId?: string
  private readonly publicSlug: string
  private readonly role: CreateFirebaseBackendOptions['role']

  constructor(options: CreateFirebaseBackendOptions) {
    if (!options.eventId.trim()) throw new Error('Firebase eventId가 필요합니다.')
    if (options.role === 'participant' && !options.participantId?.trim()) {
      throw new Error('참여자 projection에는 participantId가 필요합니다.')
    }
    this.driver = options.driver ?? createFirebaseSdkDriver()
    this.eventId = options.eventId
    this.includePublishedSnapshot = options.includePublishedSnapshot ?? false
    this.participantId = options.participantId
    this.publicSlug = options.publicSlug ?? options.eventId
    this.role = options.role
  }

  async execute<T = unknown>(
    command: FirebaseAuthoritativeCommand,
  ): Promise<FirebaseCommandSuccess<T>> {
    if (!this.driver.currentUser()) throw new Error('로그인 후 다시 시도해주세요.')
    const callable = reviewCommand(command)
      ? FIREBASE_CALLABLES.applyReviewCommand
      : FIREBASE_CALLABLES.applyEventCommand
    const raw = await this.driver.invoke<unknown>(callable, { eventId: this.eventId, command })
    return commandResult<T>(raw)
  }

  async revealParticipantPin(
    participantId: string,
    reason: string,
  ): Promise<{ expiresAt: string; pin: string }> {
    if (!this.driver.currentUser()) throw new Error('관리자 로그인 후 다시 시도해주세요.')
    const raw = await this.driver.invoke<unknown>(FIREBASE_CALLABLES.revealParticipantPin, {
      eventId: this.eventId,
      participantUid: participantId,
      reason,
    })
    const result = commandResult<{
      expiresAt?: string
      expiresInSeconds?: number
      pin: string
    }>(raw).value
    if (!result || typeof result.pin !== 'string') {
      throw new Error('PIN 조회 서버가 올바르지 않은 응답을 반환했습니다.')
    }
    return {
      expiresAt: typeof result.expiresAt === 'string'
        ? result.expiresAt
        : new Date(Date.now() + (result.expiresInSeconds ?? 30) * 1_000).toISOString(),
      pin: result.pin,
    }
  }

  saveAnswerDraft(
    request: SaveAnswerDraftRequest,
    onStatus?: (status: FirebaseDraftStatus) => void,
  ): FirebaseDraftWrite {
    const participantId = this.requireParticipant()
    const id = `${safeDocumentSegment(participantId)}__${safeDocumentSegment(request.slideId)}`
    const path = `events/${this.eventId}/answerDrafts/${id}`
    const baseRevision = Math.max(
      request.baseRevision,
      this.confirmedDraftRevisions.get(path) ?? request.baseRevision,
    )
    const revision = baseRevision + 1
    return this.writeDraft(
      path,
      {
        clientUpdatedAt: new Date().toISOString(),
        content: request.content,
        deviceId: DEVICE_ID,
        ownerParticipantId: participantId,
        revision,
        slideId: request.slideId,
      },
      'answer-draft',
      onStatus,
      () => this.confirmedDraftRevisions.set(path, revision),
    )
  }

  saveProjectDraft(
    request: SaveProjectDraftRequest,
    onStatus?: (status: FirebaseDraftStatus) => void,
  ): FirebaseDraftWrite {
    const participantId = this.requireParticipant()
    const path = `events/${this.eventId}/projectDrafts/${safeDocumentSegment(participantId)}`
    const baseRevision = Math.max(
      request.baseRevision,
      this.confirmedDraftRevisions.get(path) ?? request.baseRevision,
    )
    const revision = baseRevision + 1
    return this.writeDraft(
      path,
      {
        clientUpdatedAt: new Date().toISOString(),
        description: request.description,
        demoUrl: request.demoUrl ?? '',
        deviceId: DEVICE_ID,
        githubUrl: request.githubUrl ?? '',
        ownerParticipantId: participantId,
        pitch: request.pitch,
        retrospective: request.retrospective,
        revision,
        tags: request.tags ?? [],
        title: request.title,
      },
      'project-draft',
      onStatus,
      () => this.confirmedDraftRevisions.set(path, revision),
    )
  }

  savePrivateDraft(
    request: SavePrivateDraftRequest,
    onStatus?: (status: FirebaseDraftStatus) => void,
  ): FirebaseDraftWrite {
    const uid = this.driver.currentUser()?.uid
    if (!uid) throw new Error('작성 중인 내용을 저장하려면 로그인이 필요합니다.')
    const id = `${request.targetType}__${safeDocumentSegment(request.targetId)}`
    return this.writeDraft(
      `events/${this.eventId}/members/${uid}/drafts/${id}`,
      {
        clientUpdatedAt: new Date().toISOString(),
        deviceId: DEVICE_ID,
        payload: request.payload,
        targetId: request.targetId,
        targetType: request.targetType,
      },
      'private-draft',
      onStatus,
    )
  }

  saveSynthesisDraft(
    request: SaveSynthesisDraftRequest,
    onStatus?: (status: FirebaseDraftStatus) => void,
  ): FirebaseDraftWrite {
    if (this.role !== 'organizer') throw new Error('주최자만 정리 초안을 저장할 수 있습니다.')
    return this.writeDraft(
      `events/${this.eventId}/synthesis/current`,
      {
        ...request,
        clientUpdatedAt: new Date().toISOString(),
        deviceId: DEVICE_ID,
      },
      'synthesis-draft',
      onStatus,
    )
  }

  subscribe(
    listener: (snapshot: FirebaseBackendSnapshot) => void,
    onError: (cause: Error) => void = () => undefined,
  ): () => void {
    const bundle = emptyBundle()
    const metadata = new Map<string, FirebaseSnapshotMetadata>()
    const ready = new Set<string>()
    const unsubscribers: Array<() => void> = []
    const messageUnsubscribers = new Map<string, () => void>()
    let participantStageUnsubscribers: Array<() => void> = []
    let participantActiveSlideId = ''
    const messagesByThread = new Map<string, FirebaseDocumentRecord[]>()
    let rawReviewThreads: FirebaseDocumentRecord[] = []
    let revealedAnswers: FirebaseDocumentRecord[] = []
    let ownAnswers: FirebaseDocumentRecord[] = []
    let active = true
    let publicRevisionUnsubscribers: Array<() => void> = []
    let publicProjectUnsubscribe: (() => void) | null = null
    let publicProjectsEnabled = false
    let publicRevision = -1
    let publicRootDocument: FirebaseDocumentRecord | null = null
    let publicRevisionDocument: FirebaseDocumentRecord | null = null
    let publicShardDocuments: Record<PublicShardKey, FirebaseDocumentRecord[]> = {
      answers: [],
      comments: [],
      projects: [],
      stages: [],
      themes: [],
    }
    const publicShardsReady = new Set<PublicShardKey>()

    const required = this.role === 'public'
      ? ['event']
      : ['event', 'live', 'slides']

    const combinedMetadata = () => ({
      fromCache: [...metadata.values()].some((item) => item.fromCache),
      hasPendingWrites: [...metadata.values()].some((item) => item.hasPendingWrites),
    })

    const emit = () => {
      if (!active || !required.every((key) => ready.has(key))) return
      const snapshot = assembleFirebaseSnapshot(bundle, combinedMetadata())
      if (snapshot) listener(snapshot)
    }

    const rememberMetadata = (key: string, value: FirebaseSnapshotMetadata) => {
      metadata.set(key, value)
      ready.add(key)
    }

    const hydratePublicRevision = () => {
      if (!publicRootDocument || !publicRevisionDocument) return
      if (!PUBLIC_SHARD_KEYS.every((key) => publicShardsReady.has(key))) return
      bundle.publishedSnapshot = buildPublishedSnapshot(
        publicRootDocument,
        publicRevisionDocument,
        publicShardDocuments,
      )
      ready.add('publishedSnapshot')
      emit()
    }

    const watchPublicProjects = (publicPath: string, revision: number, enabled: boolean) => {
      publicProjectUnsubscribe?.()
      publicProjectUnsubscribe = null
      publicProjectsEnabled = enabled
      publicShardDocuments.projects = []
      publicShardsReady.delete('projects')
      metadata.delete(`publicRevision:${revision}:projects`)
      if (!enabled) {
        publicShardsReady.add('projects')
        hydratePublicRevision()
        return
      }
      publicProjectUnsubscribe = this.driver.watchCollection(
        {
          limit: LISTENER_LIMITS.projects,
          path: `${publicPath}/revisions/${revision}/projects`,
        },
        (snapshot) => {
          publicShardDocuments.projects = snapshot.documents
          publicShardsReady.add('projects')
          rememberMetadata(`publicRevision:${revision}:projects`, snapshot)
          hydratePublicRevision()
        },
        onError,
      )
    }

    const watchPublicRevision = (publicPath: string, revision: number) => {
      publicRevisionUnsubscribers.forEach((unsubscribe) => unsubscribe())
      publicProjectUnsubscribe?.()
      publicProjectUnsubscribe = null
      publicRevisionUnsubscribers = []
      publicRevisionDocument = null
      publicShardDocuments = { answers: [], comments: [], projects: [], stages: [], themes: [] }
      publicShardsReady.clear()
      publicRevisionUnsubscribers.push(this.driver.watchDocument(
        `${publicPath}/revisions/${revision}`,
        (snapshot) => {
          publicRevisionDocument = snapshot.document
          rememberMetadata('publishedSnapshot', snapshot)
          hydratePublicRevision()
        },
        onError,
      ))
      PUBLIC_SHARD_KEYS.filter((key) => key !== 'projects').forEach((key) => {
        publicRevisionUnsubscribers.push(this.driver.watchCollection(
          {
            limit: publicShardLimit(key),
            path: `${publicPath}/revisions/${revision}/${key}`,
          },
          (snapshot) => {
            publicShardDocuments[key] = snapshot.documents
            publicShardsReady.add(key)
            rememberMetadata(`publicRevision:${revision}:${key}`, snapshot)
            hydratePublicRevision()
          },
          onError,
        ))
      })
      watchPublicProjects(
        publicPath,
        revision,
        publicRootDocument?.data.exhibitionPublished === true,
      )
    }

    const watchDocument = (
      key: 'event' | 'live' | 'publishedSnapshot' | 'synthesis',
      path: string,
      onValue?: (document: FirebaseDocumentRecord | null) => void,
    ) => {
      unsubscribers.push(this.driver.watchDocument(path, (snapshot: FirebaseDocumentSnapshotRecord) => {
        bundle[key] = snapshot.document
        rememberMetadata(key, snapshot)
        onValue?.(snapshot.document)
        emit()
      }, onError))
    }

    const watchCollection = (
      key: CollectionKey,
      path: string,
      constraints?: Parameters<FirebaseBackendDriver['watchCollection']>[0],
      onValue?: (documents: FirebaseDocumentRecord[]) => void,
    ) => {
      const spec = constraints ?? { path }
      unsubscribers.push(this.driver.watchCollection(spec, (snapshot: FirebaseCollectionSnapshotRecord) => {
        if (onValue) onValue(snapshot.documents)
        else bundle[key] = snapshot.documents
        rememberMetadata(key, snapshot)
        emit()
      }, onError))
    }

    const hydrateReviewThreads = () => {
      bundle.reviewThreads = rawReviewThreads.map((thread) => ({
        ...thread,
        data: {
          ...thread.data,
          messages: (messagesByThread.get(thread.id) ?? []).map((message) => ({
            id: message.id,
            ...message.data,
          })),
        },
      }))
      emit()
    }

    const reconcileMessageListeners = () => {
      const currentIds = new Set(rawReviewThreads.map((thread) => thread.id))
      messageUnsubscribers.forEach((unsubscribe, threadId) => {
        if (!currentIds.has(threadId)) {
          unsubscribe()
          messageUnsubscribers.delete(threadId)
          messagesByThread.delete(threadId)
          metadata.delete(`reviewMessages:${threadId}`)
        }
      })
      rawReviewThreads.forEach((thread) => {
        if (messageUnsubscribers.has(thread.id)) return
        const unsubscribe = this.driver.watchCollection(
          {
            limit: LISTENER_LIMITS.reviewMessages,
            path: `events/${this.eventId}/reviewThreads/${thread.id}/messages`,
            order: [{ field: 'createdAt', direction: 'asc' }],
          },
          (snapshot) => {
            messagesByThread.set(thread.id, snapshot.documents)
            rememberMetadata(`reviewMessages:${thread.id}`, snapshot)
            hydrateReviewThreads()
          },
          onError,
        )
        messageUnsubscribers.set(thread.id, unsubscribe)
      })
      hydrateReviewThreads()
    }

    const watchReviewThreads = (ownerParticipantId?: string) => {
      watchCollection(
        'reviewThreads',
        `events/${this.eventId}/reviewThreads`,
        {
          limit: LISTENER_LIMITS.reviewThreads,
          path: `events/${this.eventId}/reviewThreads`,
          where: ownerParticipantId
            ? [{ field: 'ownerParticipantId', op: '==', value: ownerParticipantId }]
            : undefined,
          order: [{ field: 'updatedAt', direction: 'desc' }],
        },
        (documents) => {
          rawReviewThreads = documents
          reconcileMessageListeners()
        },
      )
    }

    const watchParticipantStage = (slideId: string) => {
      if (this.role !== 'participant' || !slideId || participantActiveSlideId === slideId) return
      participantActiveSlideId = slideId
      participantStageUnsubscribers.forEach((unsubscribe) => unsubscribe())
      participantStageUnsubscribers = []
      revealedAnswers = []
      bundle.answers = this.mergeDocuments(revealedAnswers, ownAnswers)
      bundle.comments = []
      participantStageUnsubscribers.push(this.driver.watchCollection(
        {
          limit: 100,
          path: `events/${this.eventId}/answers`,
          where: [
            { field: 'slideId', op: '==', value: slideId },
            { field: 'visibility', op: '==', value: 'revealed' },
          ],
        },
        (snapshot) => {
          revealedAnswers = snapshot.documents
          bundle.answers = this.mergeDocuments(revealedAnswers, ownAnswers)
          rememberMetadata('participantStageAnswers', snapshot)
          emit()
        },
        onError,
      ))
      participantStageUnsubscribers.push(this.driver.watchCollection(
        {
          limit: 300,
          path: `events/${this.eventId}/discussionComments`,
          where: [
            { field: 'slideId', op: '==', value: slideId },
            { field: 'visibility', op: '==', value: 'event' },
          ],
        },
        (snapshot) => {
          bundle.comments = snapshot.documents
          rememberMetadata('participantStageComments', snapshot)
          emit()
        },
        onError,
      ))
      emit()
    }

    const publicPath = `publicEvents/${this.publicSlug}`
    if (this.role === 'public' || this.includePublishedSnapshot) {
      unsubscribers.push(this.driver.watchDocument(publicPath, (snapshot) => {
        rememberMetadata('publicEvent', snapshot)
        const publicDocument = snapshot.document
        publicRootDocument = publicDocument
        if (this.role === 'public') {
          const data = publicDocument?.data ?? {}
          const join = data.join && typeof data.join === 'object'
            ? data.join as Record<string, unknown>
            : data
          bundle.event = publicDocument
            ? { ...publicDocument, data: { ...data, ...join } }
            : null
          ready.add('event')
          const slideValues = Array.isArray(join.slides) ? join.slides : []
          bundle.slides = slideValues.map((value, index) => {
            const slide = value && typeof value === 'object' ? value as Record<string, unknown> : {}
            const id = typeof slide.id === 'string' ? slide.id : `slide-${index + 1}`
            return { id, data: slide }
          })
          const live = join.live && typeof join.live === 'object'
            ? join.live as Record<string, unknown>
            : null
          bundle.live = live ? { id: 'state', data: live } : null
        }

        if (!this.includePublishedSnapshot) {
          bundle.publishedSnapshot = null
          ready.add('publishedSnapshot')
          emit()
          return
        }

        // The join projection remains small and live. Published data is assembled
        // from immutable revision shards so events can grow without hitting the
        // Firestore 1 MiB document limit.
        bundle.publishedSnapshot = publicDocument
        const pointer = Number(
          publicDocument?.data.currentRevision ?? publicDocument?.data.latestRevision ?? 0,
        )
        if (Number.isInteger(pointer) && pointer > 0 && pointer !== publicRevision) {
          publicRevision = pointer
          watchPublicRevision(publicPath, pointer)
        } else {
          const nextProjectsEnabled = publicDocument?.data.exhibitionPublished === true
          if (pointer > 0 && nextProjectsEnabled !== publicProjectsEnabled) {
            watchPublicProjects(publicPath, pointer, nextProjectsEnabled)
          }
          ready.add('publishedSnapshot')
          hydratePublicRevision()
        }
        emit()
      }, onError))
    }
    if (this.role === 'public') {
      return () => {
        active = false
        publicProjectUnsubscribe?.()
        publicRevisionUnsubscribers.forEach((unsubscribe) => unsubscribe())
        unsubscribers.forEach((unsubscribe) => unsubscribe())
      }
    }

    const eventPath = `events/${this.eventId}`
    watchDocument('event', eventPath)
    watchDocument('live', `${eventPath}/live/state`, (document) => {
      const slideId = typeof document?.data.activeSlideId === 'string'
        ? document.data.activeSlideId
        : ''
      watchParticipantStage(slideId)
    })
    watchCollection('slides', `${eventPath}/slides`, {
      limit: LISTENER_LIMITS.slides,
      path: `${eventPath}/slides`,
      order: [{ field: 'order', direction: 'asc' }],
    })

    if (this.role === 'organizer') {
      watchCollection('participants', `${eventPath}/participants`, { limit: LISTENER_LIMITS.participants, path: `${eventPath}/participants` })
      watchCollection('adminInvites', `${eventPath}/adminInvites`, { limit: LISTENER_LIMITS.adminInvites, path: `${eventPath}/adminInvites` })
      watchCollection('answerDrafts', `${eventPath}/answerDrafts`, { limit: LISTENER_LIMITS.answerDrafts, path: `${eventPath}/answerDrafts` })
      watchCollection('answers', `${eventPath}/answers`, { limit: LISTENER_LIMITS.answers, path: `${eventPath}/answers` })
      watchCollection('comments', `${eventPath}/discussionComments`, { limit: LISTENER_LIMITS.comments, path: `${eventPath}/discussionComments` })
      watchCollection('projectDrafts', `${eventPath}/projectDrafts`, { limit: LISTENER_LIMITS.projectDrafts, path: `${eventPath}/projectDrafts` })
      watchCollection('submissions', `${eventPath}/submissions`, { limit: LISTENER_LIMITS.submissions, path: `${eventPath}/submissions` })
      watchCollection('themes', `${eventPath}/themes`, { limit: LISTENER_LIMITS.themes, path: `${eventPath}/themes` })
      watchDocument('synthesis', `${eventPath}/synthesis/current`)
      watchReviewThreads()
    } else {
      const participantId = this.requireParticipant()
      watchCollection('participants', `${eventPath}/participantDirectory`, {
        limit: LISTENER_LIMITS.participants,
        path: `${eventPath}/participantDirectory`,
      })
      watchCollection('answerDrafts', `${eventPath}/answerDrafts`, {
        limit: 4,
        path: `${eventPath}/answerDrafts`,
        where: [{ field: 'ownerParticipantId', op: '==', value: participantId }],
      })
      watchCollection('answers', `${eventPath}/answers`, {
        limit: 4,
        path: `${eventPath}/answers`,
        where: [{ field: 'ownerParticipantId', op: '==', value: participantId }],
      }, (documents) => {
        ownAnswers = documents
        bundle.answers = this.mergeDocuments(revealedAnswers, ownAnswers)
      })
      watchCollection('projectDrafts', `${eventPath}/projectDrafts`, {
        limit: 1,
        path: `${eventPath}/projectDrafts`,
        where: [{ field: 'ownerParticipantId', op: '==', value: participantId }],
      })
      watchCollection('submissions', `${eventPath}/submissions`, {
        limit: 1,
        path: `${eventPath}/submissions`,
        where: [{ field: 'ownerParticipantId', op: '==', value: participantId }],
      })
      watchReviewThreads(participantId)
    }

    return () => {
      active = false
      participantStageUnsubscribers.forEach((unsubscribe) => unsubscribe())
      publicProjectUnsubscribe?.()
      publicRevisionUnsubscribers.forEach((unsubscribe) => unsubscribe())
      messageUnsubscribers.forEach((unsubscribe) => unsubscribe())
      messageUnsubscribers.clear()
      unsubscribers.forEach((unsubscribe) => unsubscribe())
    }
  }

  private mergeDocuments(
    first: FirebaseDocumentRecord[],
    second: FirebaseDocumentRecord[],
  ): FirebaseDocumentRecord[] {
    const merged = new Map(first.map((document) => [document.id, document]))
    second.forEach((document) => merged.set(document.id, document))
    return [...merged.values()]
  }

  private requireParticipant(): string {
    if (this.role !== 'participant' || !this.participantId) {
      throw new Error('이 작업에는 참여자 인증이 필요합니다.')
    }
    return this.participantId
  }

  private writeDraft(
    path: string,
    data: Record<string, unknown>,
    prefix: string,
    onStatus?: (status: FirebaseDraftStatus) => void,
    onConfirmed?: () => void,
  ): FirebaseDraftWrite {
    const id = mutationId(prefix)
    const localStatus: FirebaseDraftStatus = {
      mutationId: id,
      phase: 'local',
      updatedAt: new Date(),
    }
    onStatus?.(localStatus)
    const pendingStatus: FirebaseDraftStatus = { ...localStatus, phase: 'pending' }
    onStatus?.(pendingStatus)
    const confirmation = this.driver.setDocument(path, {
      ...data,
      clientMutationId: id,
      updatedAt: this.driver.serverTimestamp(),
    }).then(() => {
      onConfirmed?.()
      const status: FirebaseDraftStatus = {
        mutationId: id,
        phase: 'confirmed',
        updatedAt: new Date(),
      }
      onStatus?.(status)
      return status
    }).catch((cause: unknown) => {
      const status: FirebaseDraftStatus = {
        error: errorFromUnknown(cause),
        mutationId: id,
        phase: 'rejected',
        updatedAt: new Date(),
      }
      onStatus?.(status)
      return status
    })
    return { confirmation, mutationId: id }
  }
}

export function createFirebaseEventBackend(
  options: CreateFirebaseBackendOptions,
): FirebaseBackend {
  return new FirebaseEventBackend(options)
}
