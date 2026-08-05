import { describe, expect, it, vi } from 'vitest'
import type { User } from 'firebase/auth'
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

class FakeDriver implements FirebaseBackendDriver {
  collectionListeners = new Map<string, (snapshot: FirebaseCollectionSnapshotRecord) => void>()
  documentListeners = new Map<string, (snapshot: FirebaseDocumentSnapshotRecord) => void>()
  invocations: Array<{ name: string; payload: unknown }> = []
  writes: Array<{ data: Record<string, unknown>; path: string }> = []

  currentUser = () => ({ uid: 'participant-01' }) as User
  serverTimestamp = () => 'SERVER_TIMESTAMP'

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
    this.documentListeners.get(path)?.({
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

  it('keeps post-submission answer and project drafts available after reconnecting', () => {
    const snapshot = assembleFirebaseSnapshot({
      adminInvites: [],
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
      participants: [],
      projectDrafts: [{ id: 'participant-01', data: {
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
    expect(snapshot?.state.submissions.map(({ status, title }) => ({ status, title }))).toEqual([
      { status: 'draft', title: '수정 중인 작품' },
      { status: 'submitted', title: '제출한 작품' },
    ])
  })

  it('assembles immutable public revision shards into the exhibition projection', () => {
    const driver = new FakeDriver()
    const backend = createFirebaseEventBackend({
      driver,
      eventId: 'room-vibe26',
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
