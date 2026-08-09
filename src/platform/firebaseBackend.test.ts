import { describe, expect, it, vi } from 'vitest'
import { browserPopupRedirectResolver, browserSessionPersistence, type User } from 'firebase/auth'
import {
  createFirebaseEventBackend,
  FIREBASE_CALLABLES,
  VIBECODING_FIREBASE_CONFIG,
  resolveFirebaseEventMembership,
  type FirebaseBackendDriver,
  type FirebaseCollectionSnapshotRecord,
  type FirebaseCollectionSpec,
  type FirebaseDocumentSnapshotRecord,
} from './firebaseBackend'
import { assembleFirebaseSnapshot } from './firebase/assemble'
import { VIBECODING_AUTH_DEPENDENCIES } from './firebase/config'

class FakeDriver implements FirebaseBackendDriver {
  collectionListeners = new Map<string, (snapshot: FirebaseCollectionSnapshotRecord) => void>()
  collectionSpecs: FirebaseCollectionSpec[] = []
  documentListeners = new Map<string, (snapshot: FirebaseDocumentSnapshotRecord) => void>()
  serverDocuments = new Map<string, FirebaseDocumentSnapshotRecord>()
  invocations: Array<{ name: string; payload: unknown }> = []
  writes: Array<{ data: Record<string, unknown>; path: string }> = []

  currentUser = () => ({ uid: 'participant-01' }) as User
  serverTimestamp = () => 'SERVER_TIMESTAMP'

  getDocument = async (path: string): Promise<FirebaseDocumentSnapshotRecord> => (
    this.serverDocuments.get(path) ?? {
      document: null,
      fromCache: false,
      hasPendingWrites: false,
    }
  )

  invoke = async <TResult,>(name: string, payload: unknown): Promise<TResult> => {
    this.invocations.push({ name, payload })
    return { ok: true, value: { accepted: true } } as TResult
  }

  setDocument = async (path: string, data: Record<string, unknown>): Promise<void> => {
    this.writes.push({ path, data })
  }

  watchCollection = (
    spec: FirebaseCollectionSpec,
    next: (snapshot: FirebaseCollectionSnapshotRecord) => void,
  ) => {
    this.collectionSpecs.push(spec)
    const key = `${spec.path}?${JSON.stringify(spec.where ?? [])}`
    this.collectionListeners.set(key, next)
    return () => this.collectionListeners.delete(key)
  }

  watchDocument = (
    path: string,
    next: (snapshot: FirebaseDocumentSnapshotRecord) => void,
  ) => {
    this.documentListeners.set(path, next)
    return () => this.documentListeners.delete(path)
  }

  emitDocument(path: string, id: string, data: Record<string, unknown>) {
    const snapshot = {
      document: { id, data },
      fromCache: false,
      hasPendingWrites: false,
    }
    this.serverDocuments.set(path, snapshot)
    this.documentListeners.get(path)?.(snapshot)
  }

  stageServerDocument(path: string, id: string, data: Record<string, unknown>) {
    this.serverDocuments.set(path, {
      document: { id, data },
      fromCache: false,
      hasPendingWrites: false,
    })
  }

  emitCollection(path: string, documents: Array<{ id: string; data: Record<string, unknown> }>) {
    const entry = [...this.collectionListeners.entries()].find(([key]) => key.startsWith(`${path}?`))
    entry?.[1]({ documents, fromCache: false, hasPendingWrites: false })
  }
}

describe('Firebase production boundary', () => {
  it('uses the requested Firebase web project', () => {
    expect(VIBECODING_FIREBASE_CONFIG).toMatchObject({
      appId: '1:221777482604:web:608ba46b5d66bfea021949',
      authDomain: 'vibecoding-a3ada.firebaseapp.com',
      projectId: 'vibecoding-a3ada',
    })
  })

  it('initializes session auth with the browser popup resolver', () => {
    expect(VIBECODING_AUTH_DEPENDENCIES).toMatchObject({
      persistence: browserSessionPersistence,
      popupRedirectResolver: browserPopupRedirectResolver,
    })
  })

  it('bounds every organizer collection listener to the event capacity model', () => {
    const driver = new FakeDriver()
    const backend = createFirebaseEventBackend({ driver, eventId: 'room-vibe26', role: 'organizer' })

    const unsubscribe = backend.subscribe(() => undefined)

    expect(driver.collectionSpecs.length).toBeGreaterThan(0)
    expect(driver.collectionSpecs.every((spec) => Number.isInteger(spec.limit) && spec.limit! > 0)).toBe(true)
    unsubscribe()
  })

  it('loads only the small join projection when public revision data is not requested', () => {
    const driver = new FakeDriver()
    const backend = createFirebaseEventBackend({
      driver,
      eventId: 'room-vibe26',
      includePublishedSnapshot: false,
      publicSlug: 'vibecoding-2026',
      role: 'public',
    })
    const listener = vi.fn()

    const unsubscribe = backend.subscribe(listener)
    driver.emitDocument('publicEvents/vibecoding-2026', 'vibecoding-2026', {
      latestRevision: 7,
      join: {
        participantCount: 24,
        room: { code: 'VIBE26', capacity: 100 },
        slides: [],
        live: { activeSlideIndex: 0, timerStatus: 'idle' },
      },
    })

    expect(driver.collectionSpecs).toEqual([])
    expect(listener.mock.calls.at(-1)?.[0].state.publishedSnapshot).toBeNull()
    expect(listener.mock.calls.at(-1)?.[0].state.room.code).toBe('VIBE26')
    expect(listener.mock.calls.at(-1)?.[0].state.room.participantCount).toBe(24)
    unsubscribe()
  })

  it('subscribes participant-visible answers and comments only for the active stage', () => {
    const driver = new FakeDriver()
    const backend = createFirebaseEventBackend({
      driver,
      eventId: 'room-vibe26',
      publicSlug: 'vibecoding-2026',
      participantId: 'participant-01',
      role: 'participant',
    })
    const unsubscribe = backend.subscribe(() => undefined)

    driver.emitDocument('publicEvents/vibecoding-2026', 'vibecoding-2026', {
      join: { live: {
        activeSlideId: 'stage-build',
        timerStatus: 'idle',
      } },
    })

    expect(driver.collectionSpecs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'events/room-vibe26/answers',
        where: expect.arrayContaining([
          { field: 'slideId', op: '==', value: 'stage-build' },
          { field: 'visibility', op: '==', value: 'revealed' },
        ]),
      }),
      expect.objectContaining({
        path: 'events/room-vibe26/discussionComments',
        where: expect.arrayContaining([
          { field: 'slideId', op: '==', value: 'stage-build' },
          { field: 'visibility', op: '==', value: 'event' },
        ]),
      }),
    ]))
    unsubscribe()
  })

  it('updates the participant countdown from the public live projection', () => {
    const driver = new FakeDriver()
    const backend = createFirebaseEventBackend({
      driver,
      eventId: 'room-vibe26',
      participantId: 'participant-01',
      publicSlug: 'vibecoding-2026',
      role: 'participant',
    })
    const listener = vi.fn()
    const unsubscribe = backend.subscribe(listener)

    driver.emitDocument('events/room-vibe26', 'room-vibe26', {
      capacity: 100,
      code: 'VIBE26',
      eventDate: '2026-08-09',
      lifecycle: 'live',
      organizerName: '주최자',
      tagline: '행사',
      title: '바이브코딩',
    })
    driver.emitCollection('events/room-vibe26/slides', [{
      id: 'stage-build',
      data: { durationSec: 600, order: 1, title: '만들기' },
    }])
    driver.emitDocument('publicEvents/vibecoding-2026', 'vibecoding-2026', {
      join: { live: {
        activeSlideId: 'stage-build',
        durationSec: 600,
        endsAt: null,
        remainingSec: 600,
        revision: 1,
        timerStatus: 'idle',
      } },
    })
    expect(listener.mock.calls.at(-1)?.[0].state.live.timer.status).toBe('idle')

    const endsAt = new Date('2026-08-09T13:20:00.000Z')
    driver.emitDocument('publicEvents/vibecoding-2026', 'vibecoding-2026', {
      join: { live: {
        activeSlideId: 'stage-build',
        durationSec: 600,
        endsAt,
        remainingSec: 600,
        revision: 2,
        timerStatus: 'running',
      } },
    })

    expect(listener.mock.calls.at(-1)?.[0].state.live.timer).toEqual({
      durationSec: 600,
      endsAt: endsAt.getTime(),
      remainingSec: 600,
      status: 'running',
    })

    driver.emitDocument('events/room-vibe26/live/state', 'state', {
      activeSlideId: 'stage-build',
      durationSec: 600,
      endsAt: null,
      remainingSec: 69,
      revision: 3,
      timerStatus: 'paused',
    })
    expect(listener.mock.calls.at(-1)?.[0].state.live.timer).toEqual({
      durationSec: 600,
      endsAt: null,
      remainingSec: 69,
      status: 'paused',
    })

    driver.emitDocument('publicEvents/vibecoding-2026', 'vibecoding-2026', {
      join: { live: {
        activeSlideId: 'stage-build',
        durationSec: 600,
        endsAt,
        remainingSec: 600,
        revision: 2,
        timerStatus: 'running',
      } },
    })
    expect(listener.mock.calls.at(-1)?.[0].state.live.timer.status).toBe('paused')
    expect(driver.documentListeners.has('events/room-vibe26/live/state')).toBe(true)
    unsubscribe()
  })

  it('reconciles a missed pause from the server while the participant timer is running', async () => {
    vi.useFakeTimers()
    const driver = new FakeDriver()
    const backend = createFirebaseEventBackend({
      driver,
      eventId: 'room-vibe26',
      participantId: 'participant-01',
      publicSlug: 'vibecoding-2026',
      role: 'participant',
    })
    const listener = vi.fn()
    const unsubscribe = backend.subscribe(listener)

    try {
      driver.emitDocument('events/room-vibe26', 'room-vibe26', {
        capacity: 100,
        code: 'VIBE26',
        lifecycle: 'live',
        title: '바이브코딩',
      })
      driver.emitCollection('events/room-vibe26/slides', [{
        id: 'stage-build',
        data: { durationSec: 600, order: 1, title: '만들기' },
      }])
      driver.emitDocument('publicEvents/vibecoding-2026', 'vibecoding-2026', {
        join: { live: {
          activeSlideId: 'stage-build',
          durationSec: 600,
          endsAt: new Date('2026-08-09T13:20:00.000Z'),
          remainingSec: 600,
          revision: 20,
          timerStatus: 'running',
        } },
      })
      expect(listener.mock.calls.at(-1)?.[0].state.live.timer.status).toBe('running')

      // Simulate the organizer pause reaching Firestore while the browser's
      // onSnapshot stream misses or delays that update.
      driver.stageServerDocument('publicEvents/vibecoding-2026', 'vibecoding-2026', {
        join: { live: {
          activeSlideId: 'stage-build',
          durationSec: 600,
          endsAt: null,
          remainingSec: 73,
          revision: 21,
          timerStatus: 'paused',
        } },
      })

      await vi.advanceTimersByTimeAsync(1_000)

      expect(listener.mock.calls.at(-1)?.[0].state.live.timer).toEqual({
        durationSec: 600,
        endsAt: null,
        remainingSec: 73,
        status: 'paused',
      })
    } finally {
      unsubscribe()
      vi.useRealTimers()
    }
  })

  it('writes participant answer drafts directly and reports server confirmation', async () => {
    const driver = new FakeDriver()
    const backend = createFirebaseEventBackend({
      driver,
      eventId: 'room-vibe26',
      participantId: 'participant-01',
      role: 'participant',
    })
    const statuses: string[] = []
    const write = backend.saveAnswerDraft(
      { baseRevision: 0, content: '  공백까지 보존하는 초안  ', slideId: 'stage-build' },
      (status) => statuses.push(status.phase),
    )
    const confirmation = await write.confirmation

    expect(statuses).toEqual(['local', 'pending', 'confirmed'])
    expect(confirmation.phase).toBe('confirmed')
    expect(driver.writes[0]).toMatchObject({
      path: 'events/room-vibe26/answerDrafts/participant-01__stage-build',
      data: {
        content: '  공백까지 보존하는 초안  ',
        ownerParticipantId: 'participant-01',
        revision: 1,
        slideId: 'stage-build',
        updatedAt: 'SERVER_TIMESTAMP',
      },
    })
  })

  it('advances the locally confirmed draft revision for rapid serialized saves', async () => {
    const driver = new FakeDriver()
    const backend = createFirebaseEventBackend({
      driver,
      eventId: 'room-vibe26',
      participantId: 'participant-01',
      role: 'participant',
    })

    await backend.saveAnswerDraft({
      baseRevision: 0,
      content: '첫 저장',
      slideId: 'stage-build',
    }).confirmation
    await backend.saveAnswerDraft({
      baseRevision: 0,
      content: '첫 저장 직후의 두 번째 저장',
      slideId: 'stage-build',
    }).confirmation

    expect(driver.writes.map((write) => write.data.revision)).toEqual([1, 2])
  })

  it('keeps the selected exhibition cover in the Firebase project draft', async () => {
    const driver = new FakeDriver()
    const backend = createFirebaseEventBackend({
      driver,
      eventId: 'room-vibe26',
      participantId: 'participant-01',
      role: 'participant',
    })

    await backend.saveProjectDraft({
      baseRevision: 0,
      coverImage: '/assets/illustrations/cat-exhibition.webp',
      description: '작품 설명',
      demoUrl: 'https://example.com/demo',
      githubUrl: '',
      pitch: '한 줄 소개',
      retrospective: '제작 회고',
      tags: ['Firebase'],
      title: '전시 게시물',
    }).confirmation

    expect(driver.writes[0]).toMatchObject({
      path: 'events/room-vibe26/projectDrafts/participant-01',
      data: {
        coverImage: '/assets/illustrations/cat-exhibition.webp',
        ownerParticipantId: 'participant-01',
        revision: 1,
      },
    })
  })

  it('routes private review mutations through the review callable', async () => {
    const driver = new FakeDriver()
    const backend = createFirebaseEventBackend({ driver, eventId: 'room-vibe26', role: 'organizer' })

    await backend.execute({ type: 'ADD_REVIEW_REPLY', body: '확인했습니다.', threadId: 'thread-01' })

    expect(driver.invocations).toEqual([{
      name: FIREBASE_CALLABLES.applyReviewCommand,
      payload: {
        eventId: 'room-vibe26',
        command: { type: 'ADD_REVIEW_REPLY', body: '확인했습니다.', threadId: 'thread-01' },
      },
    }])
  })

  it('resolves event-scoped membership instead of trusting token role claims', async () => {
    const driver = new FakeDriver()
    const membership = resolveFirebaseEventMembership('room-vibe26', 'participant-01', driver)
    driver.emitDocument(
      'events/room-vibe26/members/participant-01',
      'participant-01',
      { role: 'participant', status: 'active', uid: 'participant-01' },
    )

    await expect(membership).resolves.toMatchObject({
      eventId: 'room-vibe26',
      participantId: 'participant-01',
      role: 'participant',
      uid: 'participant-01',
    })
  })

  it('assembles organizer entities without placing PIN secrets in the view model', () => {
    const driver = new FakeDriver()
    const backend = createFirebaseEventBackend({ driver, eventId: 'room-vibe26', role: 'organizer' })
    const listener = vi.fn()
    const unsubscribe = backend.subscribe(listener)

    driver.emitDocument('events/room-vibe26', 'room-vibe26', {
      capacity: 100,
      code: 'VIBE26',
      eventDate: '2026-08-05',
      organizerName: '주최자',
      tagline: '행사',
      title: '바이브코딩',
    })
    driver.emitDocument('events/room-vibe26/live/state', 'state', {
      activeSlideId: 'stage-build',
      durationSec: 600,
      remainingSec: 600,
      timerStatus: 'idle',
    })
    driver.emitCollection('events/room-vibe26/slides', [{
      id: 'stage-build',
      data: {
        answersRevealed: false,
        commentsEnabled: false,
        durationSec: 600,
        order: 1,
        title: '만들기',
      },
    }])
    driver.emitCollection('events/room-vibe26/participants', [{
      id: 'participant-01',
      data: {
        nickname: '별빛',
        normalizedNickname: '별빛',
        pin: '2468',
      },
    }])

    const snapshot = listener.mock.calls.at(-1)?.[0]
    expect(snapshot.state.participants[0]).toMatchObject({ nickname: '별빛', pin: '' })
    expect(JSON.stringify(snapshot.state)).not.toContain('2468')
    unsubscribe()
  })

  it('prefers canonical live timer fields over a stale legacy timer object', () => {
    const endsAt = new Date('2026-08-09T08:20:00.000Z')
    const snapshot = assembleFirebaseSnapshot({
      adminInvites: [],
      answerDrafts: [],
      answers: [],
      comments: [],
      event: { id: 'room-vibe26', data: {
        capacity: 100,
        code: 'VIBE26',
        eventDate: '2026-08-09',
        organizerName: '주최자',
        tagline: '행사',
        title: '바이브코딩',
      } },
      live: { id: 'state', data: {
        activeSlideId: 'stage-build',
        durationSec: 600,
        endsAt,
        remainingSec: 600,
        timerStatus: 'running',
        timer: {
          durationSec: 180,
          endsAt: null,
          remainingSec: 180,
          status: 'idle',
        },
      } },
      liveChatMessages: [],
      liveReactions: [],
      participants: [],
      projectDrafts: [],
      publishedSnapshot: null,
      reviewThreads: [],
      slides: [{ id: 'stage-build', data: { durationSec: 600, order: 1, title: '만들기' } }],
      submissions: [],
      synthesis: null,
      themes: [],
    }, { fromCache: false, hasPendingWrites: false })

    expect(snapshot).not.toBeNull()
    expect(snapshot!.state.live.timer).toEqual({
      durationSec: 600,
      endsAt: endsAt.getTime(),
      remainingSec: 600,
      status: 'running',
    })
  })

  it('keeps post-submission answer and project drafts available after reconnecting', () => {
    const snapshot = assembleFirebaseSnapshot({
      adminInvites: [{ id: 'invite-01', data: {
        acceptedBy: 'admin-user',
        email: 'admin@example.com',
        invitedAt: '2026-08-05T11:00:00.000Z',
        status: 'accepted',
      } }],
      answerDrafts: [{ id: 'participant-01__stage-build', data: {
        content: '제출 뒤에 고친 답변',
        ownerParticipantId: 'participant-01',
        slideId: 'stage-build',
        updatedAt: '2026-08-05T12:02:00.000Z',
      } }],
      answers: [{ id: 'answer-01', data: {
        ownerParticipantId: 'participant-01',
        slideId: 'stage-build',
        submittedContent: '먼저 제출한 답변',
        submittedAt: '2026-08-05T12:00:00.000Z',
      } }],
      comments: [],
      event: { id: 'room-vibe26', data: {
        capacity: 100,
        code: 'VIBE26',
        eventDate: '2026-08-05',
        organizerName: '주최자',
        tagline: '행사',
        title: '바이브코딩',
      } },
      live: null,
      liveChatMessages: [],
      liveReactions: [],
      participants: [],
      projectDrafts: [{ id: 'participant-01', data: {
        coverImage: '/assets/illustrations/cat-exhibition.webp',
        description: '제출 뒤에 고친 작품',
        ownerParticipantId: 'participant-01',
        title: '수정 중인 작품',
        updatedAt: '2026-08-05T12:04:00.000Z',
      } }],
      publishedSnapshot: null,
      reviewThreads: [],
      slides: [],
      submissions: [{ id: 'submission-01', data: {
        description: '먼저 제출한 작품',
        ownerParticipantId: 'participant-01',
        submittedAt: '2026-08-05T12:03:00.000Z',
        title: '제출한 작품',
      } }],
      synthesis: null,
      themes: [],
    }, { fromCache: false, hasPendingWrites: false })

    expect(snapshot?.state.answers.map(({ content, status }) => ({ content, status }))).toEqual([
      { content: '제출 뒤에 고친 답변', status: 'draft' },
      { content: '먼저 제출한 답변', status: 'submitted' },
    ])
    expect(snapshot?.state.adminInvites[0]).toMatchObject({
      acceptedBy: 'admin-user',
      status: 'accepted',
    })
    expect(snapshot?.state.submissions.map(({ coverImage, status, title }) => ({ coverImage, status, title }))).toEqual([
      { coverImage: '/assets/illustrations/cat-exhibition.webp', status: 'draft', title: '수정 중인 작품' },
      { coverImage: '/assets/illustrations/cat-submission.webp', status: 'submitted', title: '제출한 작품' },
    ])
  })

  it('assembles immutable public revision shards into the exhibition projection', () => {
    const driver = new FakeDriver()
    const backend = createFirebaseEventBackend({
      driver,
      eventId: 'room-vibe26',
      includePublishedSnapshot: true,
      publicSlug: 'vibecoding-2026',
      role: 'public',
    })
    const listener = vi.fn()
    backend.subscribe(listener)
    driver.emitDocument('publicEvents/vibecoding-2026', 'vibecoding-2026', {
      exhibitionPublished: true,
      latestRevision: 2,
      title: '바이브코딩',
      join: {
        room: { code: 'VIBE26', capacity: 100, eventDate: '2026-08-22', organizerName: '주최자' },
        slides: [],
        live: { activeSlideIndex: 0, durationSec: 600, remainingSec: 600, timerStatus: 'idle' },
      },
    })
    driver.emitDocument('publicEvents/vibecoding-2026/revisions/2', '2', {
      revision: 2,
      status: 'published',
      title: '바이브코딩',
      summary: '함께 만든 기록',
      nicknamePolicy: 'nickname',
      exhibitionPublished: true,
      metrics: { participantCount: 24, submittedAnswerCount: 1, commentCount: 1, projectCount: 1, completionRate: 75 },
      publishedAt: '2026-08-05T03:00:00.000Z',
    })
    driver.emitCollection('publicEvents/vibecoding-2026/revisions/2/stages', [{
      id: 'stage-build', data: { id: 'stage-build', order: 1, title: '만들기', prompt: '무엇을 만드나요?' },
    }])
    driver.emitCollection('publicEvents/vibecoding-2026/revisions/2/answers', [{
      id: 'answer-public', data: { id: 'answer-public', stageId: 'stage-build', authorName: '별빛', content: '행사 기록을 잉습니다.' },
    }])
    driver.emitCollection('publicEvents/vibecoding-2026/revisions/2/comments', [{
      id: 'comment-public', data: { answerId: 'answer-public', authorName: '달빛', body: '좋은 아이디어예요.' },
    }])
    driver.emitCollection('publicEvents/vibecoding-2026/revisions/2/projects', [{
      id: 'project-public', data: { title: '행사 릴레이', authorName: '별빛', tags: ['Firebase'] },
    }])
    driver.emitCollection('publicEvents/vibecoding-2026/revisions/2/themes', [{
      id: 'theme-data', data: { label: '이어쓰는 데이터', answerCount: 1, excerpts: ['행사 기록'] },
    }])

    const snapshot = listener.mock.calls.at(-1)?.[0]
    expect(snapshot.state.publishedSnapshot.data).toMatchObject({
      title: '바이브코딩',
      roomCode: 'VIBE26',
      stages: [{ key: 'stage-build', answers: [{ key: 'answer-public', comments: [{ body: '좋은 아이디어예요.' }] }] }],
      projects: [{ key: 'project-public', title: '행사 릴레이' }],
    })

    driver.emitDocument('publicEvents/vibecoding-2026', 'vibecoding-2026', {
      exhibitionPublished: false,
      latestRevision: 2,
      title: '바이브코딩',
      join: {
        room: { code: 'VIBE26', capacity: 100, eventDate: '2026-08-22', organizerName: '주최자' },
        slides: [],
        live: { activeSlideIndex: 0, durationSec: 600, remainingSec: 500, timerStatus: 'running' },
      },
    })
    expect(listener.mock.calls.at(-1)?.[0].state.publishedSnapshot.data).toMatchObject({
      exhibitionPublished: false,
      summary: '함께 만든 기록',
      stages: [{ key: 'stage-build', answers: [{ key: 'answer-public' }] }],
      projects: [],
    })
  })
})
