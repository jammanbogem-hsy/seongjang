import { createHash } from 'node:crypto'
import {
  Timestamp,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
} from 'firebase-admin/firestore'
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https'
import {
  appendAuditLog,
  requireEventActor,
  requireOwner,
  requireOrganizer,
  requireParticipant,
  requireSignedIn,
  type EventActor,
} from './lib/authz.js'
import { CORE_RUNTIME_SERVICE_ACCOUNT, FUNCTION_COST_GUARDRAILS, REGION } from './lib/config.js'
import { db } from './lib/firebase.js'
import {
  asRecord,
  normalizeEmail,
  optionalString,
  optionalWebUrl,
  requiredBoolean,
  requiredInteger,
  requiredString,
  safeDocumentId,
  stringArray,
  type UnknownRecord,
} from './lib/validation.js'
import { publishEventProjection } from './publication.js'

interface CommandSuccess<T = unknown> {
  notice: string
  ok: true
  value: T
}

function success<T>(value: T, notice: string): CommandSuccess<T> {
  return { ok: true, value, notice }
}

function revisionOf(snapshot: DocumentSnapshot): number {
  return Number(snapshot.get('revision') ?? 0) + 1
}

function eventPath(eventId: string, suffix: string): string {
  return `events/${eventId}/${suffix}`
}

function answerDocumentId(uid: string, slideId: string): string {
  return `${uid}__${slideId}`
}

function commandInput(command: UnknownRecord, label: string): UnknownRecord {
  return command.input === undefined ? command : asRecord(command.input, label)
}

const DRAFT_GRACE_MS = 30 * 1_000
const MAX_COMMENTS_PER_PARTICIPANT_PER_SLIDE = 20
const MAX_COMMENTS_PER_SLIDE = 300
const MAX_REVIEW_MESSAGES_PER_THREAD = 50
const MIN_REVIEW_REPLY_INTERVAL_MS = 2_000
const MAX_REVIEW_THREADS_PER_TARGET = 5
const MAX_REVIEW_THREADS_PER_PARTICIPANT = 20
const COMMAND_WINDOW_MS = 60_000
const commandBuckets = new Map<string, { count: number; window: number }>()

function consumeInstanceCommandBudget(eventId: string, actor: EventActor): void {
  const window = Math.floor(Date.now() / COMMAND_WINDOW_MS)
  const key = `${eventId}:${actor.uid}`
  const current = commandBuckets.get(key)
  const count = current?.window === window ? current.count + 1 : 1
  const maximum = actor.role === 'participant' ? 60 : 120
  if (count > maximum) {
    throw new HttpsError('resource-exhausted', '요청이 너무 빠릅니다. 잠시 뒤 다시 시도해주세요.')
  }
  commandBuckets.set(key, { count, window })
  if (commandBuckets.size > 1_000) {
    for (const [candidate, bucket] of commandBuckets) {
      if (bucket.window < window) commandBuckets.delete(candidate)
    }
  }
}

function requireRecentOwnerAuth(auth: CallableRequest<unknown>['auth']): void {
  const authTime = Number(auth?.token.auth_time ?? 0) * 1_000
  if (!Number.isFinite(authTime) || Date.now() - authTime > 10 * 60 * 1_000) {
    throw new HttpsError('failed-precondition', '관리자 권한 변경 전에 Owner 계정으로 다시 인증해주세요.')
  }
}

function assertAnswerWindow(
  live: DocumentSnapshot,
  slide: DocumentSnapshot,
  slideId: string,
  allowPreviousSlideGrace = false,
): void {
  const draftGraceUntil = live.get('draftGraceUntil')
  const withinPreviousSlideGrace = allowPreviousSlideGrace
    && live.get('previousSlideId') === slideId
    && draftGraceUntil instanceof Timestamp
    && draftGraceUntil.toMillis() > Date.now()
  if (live.get('activeSlideId') !== slideId && !withinPreviousSlideGrace) {
    throw new HttpsError('failed-precondition', '현재 진행 중인 질문에만 답변할 수 있습니다.')
  }
  if (slide.get('answersRevealed') === true) {
    throw new HttpsError('failed-precondition', '이미 공개된 단계의 답변은 수정할 수 없습니다.')
  }
  if (!withinPreviousSlideGrace && live.get('timerStatus') === 'complete') {
    throw new HttpsError('deadline-exceeded', '답변 시간이 종료되었습니다.')
  }
  const endsAt = live.get('endsAt')
  if (!withinPreviousSlideGrace && endsAt instanceof Timestamp && endsAt.toMillis() <= Date.now()) {
    throw new HttpsError('deadline-exceeded', '답변 시간이 종료되었습니다.')
  }
}

async function eventAndPublicRoot(eventId: string): Promise<{
  event: DocumentSnapshot
  publicRootPath: string
}> {
  const event = await db.doc(`events/${eventId}`).get()
  if (!event.exists) throw new HttpsError('not-found', '행사를 찾을 수 없습니다.')
  const slug = String(event.get('publicSlug') ?? '')
  if (!/^[a-z0-9-]{3,80}$/.test(slug)) {
    throw new HttpsError('failed-precondition', '행사의 공개 URL 설정을 확인해주세요.')
  }
  return { event, publicRootPath: `publicEvents/${slug}` }
}

function publicLiveProjection(live: DocumentData): DocumentData {
  return {
    activeSlideId: live.activeSlideId,
    activeSlideIndex: live.activeSlideIndex,
    sessionStatus: live.sessionStatus,
    timerStatus: live.timerStatus,
    durationSec: live.durationSec,
    remainingSec: live.remainingSec,
    endsAt: live.endsAt ?? null,
    revision: live.revision,
    updatedAt: live.updatedAt,
  }
}

async function setActiveSlide(
  eventId: string,
  command: UnknownRecord,
  actor: EventActor,
): Promise<CommandSuccess> {
  const requestedSlideId = typeof command.slideId === 'string'
    ? safeDocumentId(command.slideId, '슬라이드 ID')
    : null
  const requestedSlideIndex = requestedSlideId === null
    ? requiredInteger(command, 'slideIndex', 0, 99)
    : null
  const slide = requestedSlideId
    ? await db.doc(eventPath(eventId, `slides/${requestedSlideId}`)).get()
    : (await db.collection(eventPath(eventId, 'slides'))
        .where('order', '==', requestedSlideIndex! + 1)
        .limit(1)
        .get()).docs[0]
  if (!slide?.exists) throw new HttpsError('not-found', '해당 슬라이드를 찾을 수 없습니다.')
  const slideIndex = Math.max(0, Number(slide.get('order') ?? 1) - 1)
  const { publicRootPath } = await eventAndPublicRoot(eventId)
  const liveRef = db.doc(eventPath(eventId, 'live/state'))
  const value = await db.runTransaction(async (transaction) => {
    const live = await transaction.get(liveRef)
    if (!live.exists) throw new HttpsError('not-found', '진행 상태를 찾을 수 없습니다.')
    if (live.get('activeSlideId') === slide.id) return live.data()
    const now = Timestamp.now()
    const next = {
      activeSlideId: slide.id,
      activeSlideIndex: slideIndex,
      previousSlideId: live.get('activeSlideId') ?? null,
      draftGraceUntil: Timestamp.fromMillis(now.toMillis() + DRAFT_GRACE_MS),
      sessionStatus: 'live',
      timerStatus: 'idle',
      durationSec: Number(slide.get('durationSec') ?? 0),
      remainingSec: Number(slide.get('durationSec') ?? 0),
      endsAt: null,
      startedAt: live.get('startedAt') ?? now,
      revision: revisionOf(live),
      updatedAt: now,
      updatedBy: actor.uid,
    }
    transaction.set(liveRef, next)
    transaction.update(db.doc(publicRootPath), 'join.live', publicLiveProjection(next), 'join.updatedAt', now)
    return next
  })
  return success(value, `${slideIndex + 1}단계로 모든 화면을 맞췄습니다.`)
}

async function updateTimer(
  eventId: string,
  type: 'PAUSE_TIMER' | 'RESET_TIMER' | 'RESUME_TIMER' | 'START_TIMER',
  actor: EventActor,
): Promise<CommandSuccess> {
  const { publicRootPath } = await eventAndPublicRoot(eventId)
  const liveRef = db.doc(eventPath(eventId, 'live/state'))
  const value = await db.runTransaction(async (transaction) => {
    const live = await transaction.get(liveRef)
    if (!live.exists) throw new HttpsError('not-found', '진행 상태를 찾을 수 없습니다.')
    const nowMs = Date.now()
    const durationSec = Number(live.get('durationSec') ?? 0)
    const endsAt = live.get('endsAt')
    const derivedRemaining = endsAt instanceof Timestamp
      ? Math.max(0, Math.ceil((endsAt.toMillis() - nowMs) / 1_000))
      : Number(live.get('remainingSec') ?? durationSec)
    let timerStatus: string
    let remainingSec: number
    let nextEndsAt: Timestamp | null
    if (type === 'PAUSE_TIMER') {
      remainingSec = derivedRemaining
      timerStatus = remainingSec === 0 ? 'complete' : 'paused'
      nextEndsAt = null
    } else if (type === 'RESET_TIMER') {
      remainingSec = durationSec
      timerStatus = 'idle'
      nextEndsAt = null
    } else {
      remainingSec = derivedRemaining === 0 ? durationSec : derivedRemaining
      timerStatus = 'running'
      nextEndsAt = Timestamp.fromMillis(nowMs + remainingSec * 1_000)
    }
    const next = {
      ...live.data(),
      timerStatus,
      remainingSec,
      endsAt: nextEndsAt,
      revision: revisionOf(live),
      updatedAt: Timestamp.now(),
      updatedBy: actor.uid,
    }
    transaction.set(liveRef, next)
    if (type === 'START_TIMER' || type === 'RESUME_TIMER') {
      transaction.set(db.doc(`events/${eventId}`), {
        registrationClosedAt: next.updatedAt,
        registrationOpen: false,
        updatedAt: next.updatedAt,
      }, { merge: true })
    }
    transaction.update(
      db.doc(publicRootPath),
      'join.live', publicLiveProjection(next),
      'join.updatedAt', next.updatedAt,
    )
    return next
  })
  const notice = type === 'PAUSE_TIMER'
    ? '타이머를 일시정지했습니다.'
    : type === 'RESET_TIMER'
      ? '타이머를 초기화했습니다.'
      : '타이머를 시작했습니다.'
  return success(value, notice)
}

async function setAnswerVisibilityAtomically(
  eventId: string,
  slideId: string,
  revealed: boolean,
  actor: EventActor,
  slideRef: DocumentReference,
  publicRootRef: DocumentReference,
): Promise<{ answersRevealed: boolean; commentsEnabled: boolean; slideId: string }> {
  return db.runTransaction(async (transaction) => {
    const [slide, publicRoot] = await Promise.all([
      transaction.get(slideRef),
      transaction.get(publicRootRef),
    ])
    if (!slide.exists || !publicRoot.exists) {
      throw new HttpsError('not-found', '슬라이드 공개 정보를 찾을 수 없습니다.')
    }
    const currentCommentsEnabled = slide.get('commentsEnabled') === true
    if (
      slide.get('answersRevealed') === revealed
      && (revealed || currentCommentsEnabled === false)
    ) {
      return {
        slideId,
        answersRevealed: revealed,
        commentsEnabled: revealed ? currentCommentsEnabled : false,
      }
    }
    const answers = await transaction.get(
      db.collection(eventPath(eventId, 'answers')).where('slideId', '==', slideId),
    )
    const answerIds = answers.docs.map((answer) => answer.id)
    const commentSnapshots = []
    for (let offset = 0; offset < answerIds.length; offset += 30) {
      commentSnapshots.push(await transaction.get(
        db.collection(eventPath(eventId, 'discussionComments'))
          .where('answerId', 'in', answerIds.slice(offset, offset + 30)),
      ))
    }
    const comments = commentSnapshots.flatMap((snapshot) => snapshot.docs)
    if (answers.size + comments.length + 2 > 480) {
      throw new HttpsError(
        'resource-exhausted',
        '이 단계의 댓글이 많아 공개 상태를 바꾸지 못했습니다. 먼저 댓글을 정리해주세요.',
      )
    }
    const updatedAt = Timestamp.now()
    const patch = {
      answersRevealed: revealed,
      ...(revealed ? {} : { commentsEnabled: false }),
    }
    const join = publicRoot.get('join') as { slides?: Array<Record<string, unknown>> } | undefined
    const slides = Array.isArray(join?.slides)
      ? join.slides.map((item) => item.id === slideId ? { ...item, ...patch } : item)
      : []
    transaction.update(slideRef, { ...patch, updatedAt, updatedBy: actor.uid })
    transaction.update(publicRootRef, 'join.slides', slides, 'join.updatedAt', updatedAt)
    for (const answer of answers.docs) {
      transaction.update(answer.ref, { visibility: revealed ? 'revealed' : 'owner' })
    }
    for (const comment of comments) {
      transaction.update(comment.ref, { visibility: revealed ? 'event' : 'private' })
    }
    return {
      slideId,
      answersRevealed: revealed,
      commentsEnabled: revealed ? slide.get('commentsEnabled') === true : false,
    }
  })
}

async function updateSlideGate(
  eventId: string,
  command: UnknownRecord,
  type: 'SET_ANSWERS_REVEALED' | 'SET_COMMENTS_ENABLED',
  actor: EventActor,
): Promise<CommandSuccess> {
  const slideId = safeDocumentId(requiredString(command, 'slideId', { max: 128 }), '슬라이드 ID')
  const enabled = type === 'SET_ANSWERS_REVEALED'
    ? requiredBoolean(command, 'revealed')
    : requiredBoolean(command, 'enabled')
  const { publicRootPath } = await eventAndPublicRoot(eventId)
  const slideRef = db.doc(eventPath(eventId, `slides/${slideId}`))
  const publicRootRef = db.doc(publicRootPath)
  if (type === 'SET_ANSWERS_REVEALED') {
    const value = await setAnswerVisibilityAtomically(
      eventId,
      slideId,
      enabled,
      actor,
      slideRef,
      publicRootRef,
    )
    return success(
      value,
      enabled ? '답변을 공개했습니다.' : '답변을 다시 비공개로 전환했습니다.',
    )
  }
  const value = await db.runTransaction(async (transaction) => {
    const [slide, publicRoot] = await Promise.all([
      transaction.get(slideRef),
      transaction.get(publicRootRef),
    ])
    if (!slide.exists || !publicRoot.exists) {
      throw new HttpsError('not-found', '슬라이드 공개 정보를 찾을 수 없습니다.')
    }
    if (type === 'SET_COMMENTS_ENABLED' && enabled && slide.get('answersRevealed') !== true) {
      throw new HttpsError('failed-precondition', '답변을 먼저 공개해야 댓글을 열 수 있습니다.')
    }
    if (slide.get('commentsEnabled') === enabled) {
      return { slideId, commentsEnabled: enabled }
    }
    const patch = { commentsEnabled: enabled }
    const updatedAt = Timestamp.now()
    transaction.update(slideRef, { ...patch, updatedAt, updatedBy: actor.uid })

    const join = publicRoot.get('join') as { slides?: Array<Record<string, unknown>> } | undefined
    const slides = Array.isArray(join?.slides)
      ? join!.slides!.map((item) => item.id === slideId ? { ...item, ...patch } : item)
      : []
    transaction.update(publicRootRef, 'join.slides', slides, 'join.updatedAt', updatedAt)
    return { slideId, ...patch }
  })
  const notice = enabled ? '댓글 작성을 열었습니다.' : '댓글 작성을 잠갔습니다.'
  return success(value, notice)
}

async function saveAnswer(
  eventId: string,
  command: UnknownRecord,
  actor: EventActor & { role: 'participant' },
): Promise<CommandSuccess> {
  const input = commandInput(command, '답변')
  const slideId = safeDocumentId(requiredString(input, 'slideId', { max: 128 }), '슬라이드 ID')
  const documentId = answerDocumentId(actor.uid, slideId)
  const liveRef = db.doc(eventPath(eventId, 'live/state'))
  const slideRef = db.doc(eventPath(eventId, `slides/${slideId}`))
  const draftRef = db.doc(eventPath(eventId, `answerDrafts/${documentId}`))
  const answerRef = db.doc(eventPath(eventId, `answers/${documentId}`))
  const participantRef = db.doc(eventPath(eventId, `participants/${actor.uid}`))
  const value = await db.runTransaction(async (transaction) => {
    const [live, slide, participant, existingDraft, existingAnswer] = await Promise.all([
      transaction.get(liveRef),
      transaction.get(slideRef),
      transaction.get(participantRef),
      transaction.get(draftRef),
      transaction.get(answerRef),
    ])
    if (!live.exists || !slide.exists || !participant.exists) {
      throw new HttpsError('not-found', '답변을 저장할 행사 정보를 찾을 수 없습니다.')
    }
    assertAnswerWindow(live, slide, slideId, input.submit === false)
    const now = Timestamp.now()
    const legacyContent = typeof input.content === 'string' ? input.content : null
    const draftData = existingDraft.data()
    const content = requiredString(
      legacyContent === null ? asRecord(draftData, '답변 초안') : { content: legacyContent },
      'content',
      { min: 1, max: 1_200, label: '답변' },
    )
    if (existingDraft.exists && existingDraft.get('ownerParticipantId') !== actor.uid) {
      throw new HttpsError('permission-denied', '자신의 답변 초안만 제출할 수 있습니다.')
    }
    if (legacyContent !== null) {
      transaction.set(draftRef, {
        ownerParticipantId: actor.uid,
        slideId,
        content,
        deviceId: 'server-callable',
        clientMutationId: `server-${now.toMillis()}`,
        clientUpdatedAt: now.toDate().toISOString(),
        updatedAt: now,
      })
      if (input.submit === false) {
        return { id: documentId, ownerParticipantId: actor.uid, slideId, content, updatedAt: now }
      }
    } else if (!existingDraft.exists) {
      throw new HttpsError('failed-precondition', '먼저 답변 초안을 저장해주세요.')
    }
    const answer = {
      id: documentId,
      authorUid: actor.uid,
      ownerParticipantId: actor.uid,
      participantId: actor.uid,
      authorName: String(participant.get('nickname') ?? '참여자'),
      slideId,
      content,
      submittedContent: content,
      status: 'submitted',
      visibility: 'owner',
      createdAt: existingAnswer.get('createdAt') ?? now,
      updatedAt: now,
      submittedAt: now,
    }
    transaction.set(answerRef, answer)
    return answer
  })
  return success(value, input.submit === false ? '답변 초안을 저장했습니다.' : '개인 답변을 제출했습니다.')
}

async function addComment(
  eventId: string,
  command: UnknownRecord,
  actor: EventActor & { role: 'participant' },
): Promise<CommandSuccess> {
  const input = commandInput(command, '댓글')
  const answerId = safeDocumentId(requiredString(input, 'answerId', { max: 128 }), '답변 ID')
  const body = requiredString(input, 'body', { min: 1, max: 500, label: '댓글' })
  const answerRef = db.doc(eventPath(eventId, `answers/${answerId}`))
  const answer = await answerRef.get()
  if (!answer.exists || answer.get('status') !== 'submitted') {
    throw new HttpsError('not-found', '댓글을 남길 답변을 찾을 수 없습니다.')
  }
  const slideId = safeDocumentId(String(answer.get('slideId') ?? ''), '슬라이드 ID')
  const [slide, participant] = await Promise.all([
    db.doc(eventPath(eventId, `slides/${slideId}`)).get(),
    db.doc(eventPath(eventId, `participants/${actor.uid}`)).get(),
  ])
  if (!slide.exists || slide.get('answersRevealed') !== true || slide.get('commentsEnabled') !== true) {
    throw new HttpsError('failed-precondition', '주최자가 답변과 댓글을 공개한 뒤 작성할 수 있습니다.')
  }
  const ref = db.collection(eventPath(eventId, 'discussionComments')).doc()
  const now = Timestamp.now()
  const comment = {
    id: ref.id,
    answerId,
    authorUid: actor.uid,
    authorParticipantId: actor.uid,
    participantId: actor.uid,
    authorName: String(participant.get('nickname') ?? '참여자'),
    body,
    slideId,
    visibility: 'event',
    createdAt: now,
    updatedAt: now,
  }
  const slideRef = db.doc(eventPath(eventId, `slides/${slideId}`))
  const authorCounterRef = db.doc(eventPath(
    eventId,
    `commentAuthorCounters/${slideId}__${actor.uid}`,
  ))
  await db.runTransaction(async (transaction) => {
    const [currentSlide, authorCounter] = await Promise.all([
      transaction.get(slideRef),
      transaction.get(authorCounterRef),
    ])
    if (
      !currentSlide.exists ||
      currentSlide.get('answersRevealed') !== true ||
      currentSlide.get('commentsEnabled') !== true
    ) {
      throw new HttpsError('failed-precondition', '주최자가 답변과 댓글을 공개한 뒤 작성할 수 있습니다.')
    }
    const commentCount = Number(currentSlide.get('commentCount') ?? 0)
    const authorCommentCount = Number(authorCounter.get('count') ?? 0)
    if (commentCount >= MAX_COMMENTS_PER_SLIDE) {
      throw new HttpsError('resource-exhausted', '이 단계의 댓글 작성 한도에 도달했습니다.')
    }
    if (authorCommentCount >= MAX_COMMENTS_PER_PARTICIPANT_PER_SLIDE) {
      throw new HttpsError('resource-exhausted', '이 단계에서 작성할 수 있는 댓글 한도에 도달했습니다.')
    }
    transaction.create(ref, comment)
    transaction.update(slideRef, { commentCount: commentCount + 1, updatedAt: now })
    transaction.set(authorCounterRef, {
      count: authorCommentCount + 1,
      participantUid: actor.uid,
      slideId,
      updatedAt: now,
    }, { merge: true })
  })
  return success(comment, '댓글을 남겼습니다.')
}

async function updateOrDeleteComment(
  eventId: string,
  command: UnknownRecord,
  actor: EventActor & { role: 'participant' },
  deleting: boolean,
): Promise<CommandSuccess> {
  const input = commandInput(command, '댓글')
  const commentId = safeDocumentId(requiredString(input, 'commentId', { max: 128 }), '댓글 ID')
  const commentRef = db.doc(eventPath(eventId, `discussionComments/${commentId}`))
  const comment = await commentRef.get()
  if (!comment.exists) throw new HttpsError('not-found', '댓글을 찾을 수 없습니다.')
  if ((comment.get('authorUid') ?? comment.get('authorParticipantId')) !== actor.uid) {
    throw new HttpsError('permission-denied', '자신이 작성한 댓글만 바꿀 수 있습니다.')
  }
  if (deleting) {
    const answerId = safeDocumentId(String(comment.get('answerId') ?? ''), '답변 ID')
    const answer = await db.doc(eventPath(eventId, `answers/${answerId}`)).get()
    if (!answer.exists) throw new HttpsError('data-loss', '댓글의 답변 정보를 찾을 수 없습니다.')
    const slideId = safeDocumentId(String(answer.get('slideId') ?? ''), '슬라이드 ID')
    const slideRef = db.doc(eventPath(eventId, `slides/${slideId}`))
    const authorCounterRef = db.doc(eventPath(
      eventId,
      `commentAuthorCounters/${slideId}__${actor.uid}`,
    ))
    await db.runTransaction(async (transaction) => {
      const [currentComment, slide, authorCounter] = await Promise.all([
        transaction.get(commentRef),
        transaction.get(slideRef),
        transaction.get(authorCounterRef),
      ])
      if (!currentComment.exists) throw new HttpsError('not-found', '댓글을 찾을 수 없습니다.')
      if ((currentComment.get('authorUid') ?? currentComment.get('authorParticipantId')) !== actor.uid) {
        throw new HttpsError('permission-denied', '자신이 작성한 댓글만 지울 수 있습니다.')
      }
      transaction.delete(commentRef)
      if (slide.exists) {
        transaction.update(slideRef, {
          commentCount: Math.max(0, Number(slide.get('commentCount') ?? 0) - 1),
          updatedAt: Timestamp.now(),
        })
      }
      if (authorCounter.exists) {
        transaction.set(authorCounterRef, {
          count: Math.max(0, Number(authorCounter.get('count') ?? 0) - 1),
          updatedAt: Timestamp.now(),
        }, { merge: true })
      }
    })
    return success(null, '댓글을 삭제했습니다.')
  }
  const body = requiredString(input, 'body', { min: 1, max: 500, label: '댓글' })
  const answer = await db.doc(eventPath(eventId, `answers/${String(comment.get('answerId'))}`)).get()
  const slide = answer.exists
    ? await db.doc(eventPath(eventId, `slides/${String(answer.get('slideId'))}`)).get()
    : null
  if (!slide?.exists || slide.get('answersRevealed') !== true || slide.get('commentsEnabled') !== true) {
    throw new HttpsError('failed-precondition', '댓글 작성이 열려 있을 때만 수정할 수 있습니다.')
  }
  const updatedAt = Timestamp.now()
  await commentRef.update({ body, updatedAt })
  return success({ id: commentId, body, updatedAt }, '댓글을 수정했습니다.')
}

function projectInput(input: UnknownRecord): {
  coverImage: string
  demoUrl: string
  description: string
  githubUrl: string
  pitch: string
  retrospective: string
  tags: string[]
  title: string
} {
  const title = optionalString(input, 'title', 60)
  const pitch = optionalString(input, 'pitch', 120)
  const description = optionalString(input, 'description', 1_500)
  const retrospective = optionalString(input, 'retrospective', 1_200)
  const demoUrl = optionalWebUrl(optionalString(input, 'demoUrl', 2_000))
  const githubUrl = optionalWebUrl(optionalString(input, 'githubUrl', 2_000))
  if (!title || !pitch || !description || !retrospective) {
    throw new HttpsError('invalid-argument', '제목, 한 줄 소개, 설명과 회고를 모두 적어주세요.')
  }
  if (!demoUrl && !githubUrl) {
    throw new HttpsError('invalid-argument', '실행 URL 또는 GitHub URL이 하나 이상 필요합니다.')
  }
  return {
    title,
    pitch,
    description,
    retrospective,
    demoUrl,
    githubUrl,
    tags: stringArray(input.tags, 6, 40),
    coverImage: optionalString(input, 'coverImage', 2_000) || '/assets/illustrations/cat-submission.webp',
  }
}

async function submitProject(
  eventId: string,
  actor: EventActor & { role: 'participant' },
): Promise<CommandSuccess> {
  const participantRef = db.doc(eventPath(eventId, `participants/${actor.uid}`))
  const draftRef = db.doc(eventPath(eventId, `projectDrafts/${actor.uid}`))
  const submissionRef = db.doc(eventPath(eventId, `submissions/${actor.uid}`))
  const value = await db.runTransaction(async (transaction) => {
    const [participant, existingDraft, existingSubmission] = await Promise.all([
      transaction.get(participantRef),
      transaction.get(draftRef),
      transaction.get(submissionRef),
    ])
    if (!participant.exists || !existingDraft.exists) {
      throw new HttpsError('failed-precondition', '먼저 작품 초안을 저장해주세요.')
    }
    if (existingDraft.get('ownerParticipantId') !== actor.uid) {
      throw new HttpsError('permission-denied', '자신의 작품 초안만 제출할 수 있습니다.')
    }
    const input = projectInput(asRecord(existingDraft.data(), '작품 초안'))
    const now = Timestamp.now()
    const base = {
      id: actor.uid,
      authorUid: actor.uid,
      ownerParticipantId: actor.uid,
      participantId: actor.uid,
      authorName: String(participant.get('nickname') ?? '참여자'),
      title: input.title,
      pitch: input.pitch,
      description: input.description,
      demoUrl: input.demoUrl,
      githubUrl: input.githubUrl,
      tags: input.tags,
      retrospective: input.retrospective,
      coverImage: input.coverImage,
      createdAt: existingSubmission.get('createdAt') ?? existingDraft.get('updatedAt') ?? now,
      updatedAt: now,
    }
    const submitted = { ...base, status: 'submitted', submittedAt: now }
    transaction.set(submissionRef, submitted)
    transaction.update(participantRef, { submissionStatus: 'submitted', lastSeenAt: now })
    return submitted
  })
  return success(value, '개인 작품을 제출했습니다.')
}

async function resolveReviewTarget(eventId: string, type: string, targetId: string): Promise<DocumentSnapshot> {
  const collectionName = type === 'answer' ? 'answers' : type === 'submission' ? 'submissions' : null
  if (!collectionName) throw new HttpsError('invalid-argument', '검토 대상 종류가 올바르지 않습니다.')
  const direct = await db.doc(eventPath(eventId, `${collectionName}/${targetId}`)).get()
  if (direct.exists) return direct
  if (type === 'submission') {
    const draft = await db.doc(eventPath(eventId, `projectDrafts/${targetId}`)).get()
    if (draft.exists) return draft
  }
  const legacy = await db.collection(eventPath(eventId, collectionName)).where('id', '==', targetId).limit(1).get()
  if (!legacy.empty) return legacy.docs[0]!
  throw new HttpsError('not-found', '검토할 참여자 자료를 찾을 수 없습니다.')
}

async function addReviewThread(
  eventId: string,
  command: UnknownRecord,
  actor: EventActor,
): Promise<CommandSuccess> {
  const input = commandInput(command, '검토 의견')
  const targetType = requiredString(input, 'targetType', { max: 20 })
  const targetId = safeDocumentId(requiredString(input, 'targetId', { max: 128 }), '검토 대상 ID')
  const target = await resolveReviewTarget(eventId, targetType, targetId)
  const participantUid = safeDocumentId(
    String(target.get('ownerParticipantId') ?? target.get('authorUid') ?? ''),
    '참여자 ID',
  )
  const body = requiredString(input, 'body', { min: 1, max: 1_000, label: '검토 의견' })
  const threadRef = db.collection(eventPath(eventId, 'reviewThreads')).doc()
  const messageRef = threadRef.collection('messages').doc()
  const targetCounterRef = db.doc(eventPath(
    eventId,
    `reviewTargetCounters/${targetType}__${targetId}`,
  ))
  const participantCounterRef = db.doc(eventPath(
    eventId,
    `reviewParticipantCounters/${participantUid}`,
  ))
  const now = Timestamp.now()
  const thread = {
    id: threadRef.id,
    targetType,
    targetId,
    participantUid,
    ownerParticipantId: participantUid,
    field: optionalString(input, 'field', 80) || '전체',
    quote: optionalString(input, 'quote', 280),
    status: 'open',
    messageCount: 1,
    lastOrganizerReplyAt: now,
    lastParticipantReplyAt: null,
    createdBy: actor.uid,
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
  }
  await db.runTransaction(async (transaction) => {
    const [targetCounter, participantCounter] = await Promise.all([
      transaction.get(targetCounterRef),
      transaction.get(participantCounterRef),
    ])
    const targetCount = Number(targetCounter.get('count') ?? 0)
    const participantCount = Number(participantCounter.get('count') ?? 0)
    if (targetCount >= MAX_REVIEW_THREADS_PER_TARGET) {
      throw new HttpsError('resource-exhausted', '한 자료에는 최대 5개의 검토 대화를 만들 수 있습니다.')
    }
    if (participantCount >= MAX_REVIEW_THREADS_PER_PARTICIPANT) {
      throw new HttpsError('resource-exhausted', '한 참여자에게는 최대 20개의 검토 대화를 만들 수 있습니다.')
    }
    transaction.create(threadRef, thread)
    transaction.create(messageRef, {
      id: messageRef.id,
      authorRole: 'organizer',
      authorUid: actor.uid,
      authorParticipantId: null,
      participantId: null,
      body,
      createdAt: now,
      updatedAt: now,
    })
    transaction.set(targetCounterRef, { count: targetCount + 1, updatedAt: now }, { merge: true })
    transaction.set(participantCounterRef, { count: participantCount + 1, updatedAt: now }, { merge: true })
  })
  return success(thread, '참여자에게 비공개 검토 의견을 남겼습니다.')
}

async function updateReviewThread(
  eventId: string,
  command: UnknownRecord,
  actor: EventActor,
  type: 'ADD_REVIEW_REPLY' | 'SET_REVIEW_THREAD_STATUS',
): Promise<CommandSuccess> {
  const input = commandInput(command, '검토 의견')
  const threadId = safeDocumentId(requiredString(input, 'threadId', { max: 128 }), '검토 의견 ID')
  const threadRef = db.doc(eventPath(eventId, `reviewThreads/${threadId}`))
  const isOrganizer = actor.role === 'owner' || actor.role === 'admin'
  const now = Timestamp.now()
  if (type === 'ADD_REVIEW_REPLY') {
    const body = requiredString(input, 'body', { min: 1, max: 1_000, label: '답글' })
    const messageRef = threadRef.collection('messages').doc()
    const message = {
      id: messageRef.id,
      authorRole: isOrganizer ? 'organizer' : 'participant',
      authorUid: actor.uid,
      authorParticipantId: isOrganizer ? null : actor.uid,
      participantId: isOrganizer ? null : actor.uid,
      body,
      createdAt: now,
      updatedAt: now,
    }
    await db.runTransaction(async (transaction) => {
      const thread = await transaction.get(threadRef)
      if (!thread.exists) throw new HttpsError('not-found', '검토 의견을 찾을 수 없습니다.')
      if (!isOrganizer && (thread.get('ownerParticipantId') ?? thread.get('participantUid')) !== actor.uid) {
        throw new HttpsError('permission-denied', '이 검토 대화에 접근할 수 없습니다.')
      }
      const messageCount = Number(thread.get('messageCount') ?? 1)
      if (messageCount >= MAX_REVIEW_MESSAGES_PER_THREAD) {
        throw new HttpsError('resource-exhausted', '한 검토 대화에는 최대 50개의 메시지를 남길 수 있습니다.')
      }
      const actorLastReplyAt = thread.get(isOrganizer ? 'lastOrganizerReplyAt' : 'lastParticipantReplyAt')
      if (
        actorLastReplyAt instanceof Timestamp
        && now.toMillis() - actorLastReplyAt.toMillis() < MIN_REVIEW_REPLY_INTERVAL_MS
      ) {
        throw new HttpsError('resource-exhausted', '답글은 잠시 뒤 다시 남겨주세요.')
      }
      transaction.create(messageRef, message)
      transaction.update(threadRef, {
        updatedAt: now,
        messageCount: messageCount + 1,
        [isOrganizer ? 'lastOrganizerReplyAt' : 'lastParticipantReplyAt']: now,
      })
    })
    return success(message, '검토 의견에 답글을 남겼습니다.')
  }
  const status = requiredString(input, 'status', { max: 16 })
  if (status !== 'open' && status !== 'resolved') {
    throw new HttpsError('invalid-argument', '검토 상태가 올바르지 않습니다.')
  }
  const changed = await db.runTransaction(async (transaction) => {
    const thread = await transaction.get(threadRef)
    if (!thread.exists) throw new HttpsError('not-found', '검토 의견을 찾을 수 없습니다.')
    if (!isOrganizer && (thread.get('ownerParticipantId') ?? thread.get('participantUid')) !== actor.uid) {
      throw new HttpsError('permission-denied', '이 검토 대화에 접근할 수 없습니다.')
    }
    if (thread.get('status') === status) return false
    const lastChangedAt = thread.get('lastStatusChangedAt')
    if (
      lastChangedAt instanceof Timestamp
      && now.toMillis() - lastChangedAt.toMillis() < MIN_REVIEW_REPLY_INTERVAL_MS
    ) {
      throw new HttpsError('resource-exhausted', '검토 상태는 잠시 뒤 다시 변경해주세요.')
    }
    transaction.update(threadRef, {
      status,
      updatedAt: now,
      lastStatusChangedAt: now,
      resolvedAt: status === 'resolved' ? now : null,
      resolvedBy: status === 'resolved' ? actor.uid : null,
    })
    return true
  })
  return success(
    { id: threadId, status },
    changed
      ? (status === 'resolved' ? '검토 의견을 해결 처리했습니다.' : '검토 의견을 다시 열었습니다.')
      : '검토 상태가 이미 반영되어 있습니다.',
  )
}

async function inviteAdmin(eventId: string, command: UnknownRecord, actor: EventActor): Promise<CommandSuccess> {
  const email = normalizeEmail(requiredString(command, 'email', { max: 254 }))
  const inviteId = createHash('sha256').update(`${eventId}\u0000${email}`).digest('hex')
  const ref = db.doc(eventPath(eventId, `adminInvites/${inviteId}`))
  const now = Timestamp.now()
  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(ref)
    if (existing.exists && existing.get('status') === 'accepted') {
      throw new HttpsError('already-exists', '이미 관리자 권한을 수락한 이메일입니다.')
    }
    transaction.set(ref, {
      id: inviteId,
      email,
      emailLower: email,
      role: 'admin',
      status: 'pending',
      invitedBy: actor.uid,
      invitedAt: now,
      expiresAt: Timestamp.fromMillis(now.toMillis() + 7 * 24 * 60 * 60 * 1_000),
      acceptedAt: null,
      acceptedBy: null,
      revokedAt: null,
      revokedBy: null,
    })
  })
  return success({ id: inviteId, email, status: 'pending' }, '관리자 초대를 준비했습니다.')
}

async function revokeAdmin(eventId: string, command: UnknownRecord, actor: EventActor): Promise<CommandSuccess> {
  const inviteId = safeDocumentId(requiredString(command, 'inviteId', { max: 128 }), '초대 ID')
  const inviteRef = db.doc(eventPath(eventId, `adminInvites/${inviteId}`))
  const value = await db.runTransaction(async (transaction) => {
    const invite = await transaction.get(inviteRef)
    if (!invite.exists) throw new HttpsError('not-found', '관리자 초대를 찾을 수 없습니다.')
    const status = invite.get('status')
    if (status !== 'accepted' && status !== 'pending') {
      throw new HttpsError('failed-precondition', '대기 중이거나 활성 상태인 관리자 초대만 취소할 수 있습니다.')
    }
    const now = Timestamp.now()
    if (status === 'pending') {
      transaction.update(inviteRef, { status: 'revoked', revokedAt: now, revokedBy: actor.uid })
      return { id: inviteId, status: 'revoked' }
    }
    const acceptedBy = safeDocumentId(String(invite.get('acceptedBy') ?? ''), '관리자 ID')
    const memberRef = db.doc(eventPath(eventId, `members/${acceptedBy}`))
    const member = await transaction.get(memberRef)
    if (!member.exists || member.get('role') !== 'admin') {
      throw new HttpsError('failed-precondition', '회수할 관리자 멤버십을 확인할 수 없습니다.')
    }
    transaction.update(inviteRef, {
      status: 'revoked',
      revokedAt: now,
      revokedBy: actor.uid,
    })
    transaction.update(memberRef, { status: 'revoked', revokedAt: now, revokedBy: actor.uid })
    transaction.set(db.doc(`users/${acceptedBy}/memberships/${eventId}`), {
      status: 'revoked',
      revokedAt: now,
      revokedBy: actor.uid,
    }, { merge: true })
    return { id: inviteId, status: 'revoked' }
  })
  return success(value, '관리자 권한을 즉시 회수했습니다.')
}

async function acceptAdminInvite(eventId: string, command: UnknownRecord, auth: Parameters<typeof requireSignedIn>[0]): Promise<CommandSuccess> {
  const signedIn = requireSignedIn(auth)
  if (signedIn.token.email_verified !== true || typeof signedIn.token.email !== 'string') {
    throw new HttpsError('permission-denied', '초대받은 이메일의 확인된 계정이 필요합니다.')
  }
  const inviteId = safeDocumentId(requiredString(command, 'inviteId', { max: 128 }), '초대 ID')
  const inviteRef = db.doc(eventPath(eventId, `adminInvites/${inviteId}`))
  const eventRef = db.doc(`events/${eventId}`)
  const value = await db.runTransaction(async (transaction) => {
    const [invite, event] = await Promise.all([
      transaction.get(inviteRef),
      transaction.get(eventRef),
    ])
    if (!invite.exists || !event.exists) throw new HttpsError('not-found', '관리자 초대를 찾을 수 없습니다.')
    if (invite.get('status') !== 'pending') throw new HttpsError('failed-precondition', '이미 처리된 초대입니다.')
    const expiresAt = invite.get('expiresAt')
    if (expiresAt instanceof Timestamp && expiresAt.toMillis() <= Date.now()) {
      throw new HttpsError('deadline-exceeded', '초대 기간이 만료되었습니다.')
    }
    const email = normalizeEmail(signedIn.token.email as string)
    if (email !== invite.get('emailLower')) {
      throw new HttpsError('permission-denied', '초대받은 이메일과 로그인 계정이 다릅니다.')
    }
    const now = Timestamp.now()
    transaction.update(inviteRef, { status: 'accepted', acceptedAt: now, acceptedBy: signedIn.uid })
    transaction.set(db.doc(eventPath(eventId, `members/${signedIn.uid}`)), {
      uid: signedIn.uid,
      email,
      role: 'admin',
      status: 'active',
      joinedAt: now,
    })
    transaction.set(db.doc(`users/${signedIn.uid}/memberships/${eventId}`), {
      eventId,
      eventTitle: String(event.get('title') ?? ''),
      role: 'admin',
      status: 'active',
      joinedAt: now,
    })
    return { id: inviteId, email, status: 'accepted' }
  })
  return success(value, '관리자 권한을 수락했습니다.')
}

async function updateSynthesis(eventId: string, command: UnknownRecord, actor: EventActor): Promise<CommandSuccess> {
  const input = commandInput(command, '정리 세션')
  const expectedRevision = requiredInteger(input, 'expectedRevision', 0, 1_000_000)
  const patch: Record<string, unknown> = {
    updatedAt: Timestamp.now(),
    updatedBy: actor.uid,
  }
  if (input.organizerSummary !== undefined) patch.organizerSummary = optionalString(input, 'organizerSummary', 4_000)
  if (input.nicknamePolicy !== undefined) {
    const policy = requiredString(input, 'nicknamePolicy', { max: 16 })
    if (policy !== 'nickname' && policy !== 'anonymous') {
      throw new HttpsError('invalid-argument', '닉네임 공개 정책을 확인해주세요.')
    }
    patch.nicknamePolicy = policy
  }
  if (input.themeIds !== undefined) patch.themeIds = stringArray(input.themeIds, 50, 128)
  if (input.highlightAnswerIds !== undefined) {
    patch.highlightAnswerIds = stringArray(input.highlightAnswerIds, 100, 128)
  }
  const ref = db.doc(eventPath(eventId, 'synthesis/current'))
  const value = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    const revision = Number(snapshot.get('revision') ?? 0)
    if (revision !== expectedRevision) {
      throw new HttpsError(
        'aborted',
        '다른 관리자가 정리 내용을 먼저 저장했습니다. 최신 내용을 확인한 뒤 다시 저장해주세요.',
      )
    }
    const nextRevision = revision + 1
    transaction.set(ref, { ...patch, revision: nextRevision }, { merge: true })
    return { id: 'current', ...patch, revision: nextRevision }
  })
  return success(value, '정리 세션 내용을 저장했습니다.')
}

const participantCommands = new Set([
  'ADD_COMMENT',
  'DELETE_COMMENT',
  'SAVE_ANSWER',
  'SUBMIT_ANSWER',
  'SUBMIT_PROJECT',
  'UPDATE_COMMENT',
])
const organizerCommands = new Set([
  'ADD_REVIEW_THREAD',
  'PAUSE_TIMER',
  'PUBLISH_SYNTHESIS',
  'RESET_TIMER',
  'RESUME_TIMER',
  'SET_ACTIVE_SLIDE',
  'SET_ANSWERS_REVEALED',
  'SET_COMMENTS_ENABLED',
  'SET_EXHIBITION_PUBLISHED',
  'SET_PARTICIPANT_STATUS',
  'START_TIMER',
  'UPDATE_SYNTHESIS',
])
const ownerCommands = new Set(['INVITE_ADMIN', 'REVOKE_ADMIN'])

async function executeCommand(request: CallableRequest<unknown>): Promise<CommandSuccess> {
    const payload = asRecord(request.data)
    const eventId = safeDocumentId(requiredString(payload, 'eventId', { max: 128 }), '행사 ID')
    const command = asRecord(payload.command, '명령')
    const type = requiredString(command, 'type', { max: 64 })

    if (type === 'JOIN_PARTICIPANT') {
      throw new HttpsError('failed-precondition', 'joinOrReenterParticipant 함수를 사용해주세요.')
    }
    if (type === 'ACCEPT_ADMIN_INVITE') {
      return acceptAdminInvite(eventId, command, request.auth)
    }

    let actor: EventActor
    if (participantCommands.has(type)) actor = await requireParticipant(eventId, request.auth)
    else if (ownerCommands.has(type)) {
      actor = await requireOwner(eventId, request.auth)
      requireRecentOwnerAuth(request.auth)
    }
    else if (organizerCommands.has(type)) actor = await requireOrganizer(eventId, request.auth)
    else actor = await requireEventActor(eventId, request.auth)
    consumeInstanceCommandBudget(eventId, actor)

    let result: CommandSuccess
    switch (type) {
      case 'SET_PARTICIPANT_STATUS': {
        const targetUid = safeDocumentId(requiredString(command, 'participantId', { max: 128 }), '참여자 ID')
        const status = requiredString(command, 'status', { max: 16 })
        if (status !== 'online' && status !== 'offline') throw new HttpsError('invalid-argument', '참여 상태가 올바르지 않습니다.')
        await db.doc(eventPath(eventId, `participants/${targetUid}`)).update({
          legacyStatus: status,
          lastSeenAt: Timestamp.now(),
        })
        result = success({ id: targetUid, status }, '참여자 상태를 기록했습니다.')
        break
      }
      case 'SET_ACTIVE_SLIDE':
        result = await setActiveSlide(eventId, command, actor)
        break
      case 'START_TIMER':
      case 'PAUSE_TIMER':
      case 'RESUME_TIMER':
      case 'RESET_TIMER':
        result = await updateTimer(eventId, type, actor)
        break
      case 'SET_ANSWERS_REVEALED':
      case 'SET_COMMENTS_ENABLED':
        result = await updateSlideGate(eventId, command, type, actor)
        break
      case 'SAVE_ANSWER':
      case 'SUBMIT_ANSWER':
        result = await saveAnswer(eventId, command, actor as EventActor & { role: 'participant' })
        break
      case 'ADD_COMMENT':
        result = await addComment(eventId, command, actor as EventActor & { role: 'participant' })
        break
      case 'UPDATE_COMMENT':
        result = await updateOrDeleteComment(eventId, command, actor as EventActor & { role: 'participant' }, false)
        break
      case 'DELETE_COMMENT':
        result = await updateOrDeleteComment(eventId, command, actor as EventActor & { role: 'participant' }, true)
        break
      case 'ADD_REVIEW_THREAD':
        result = await addReviewThread(eventId, command, actor)
        break
      case 'ADD_REVIEW_REPLY':
      case 'SET_REVIEW_THREAD_STATUS':
        result = await updateReviewThread(eventId, command, actor, type)
        break
      case 'SUBMIT_PROJECT':
        result = await submitProject(eventId, actor as EventActor & { role: 'participant' })
        break
      case 'INVITE_ADMIN':
        result = await inviteAdmin(eventId, command, actor)
        break
      case 'REVOKE_ADMIN':
        result = await revokeAdmin(eventId, command, actor)
        break
      case 'UPDATE_SYNTHESIS':
        result = await updateSynthesis(eventId, command, actor)
        break
      case 'PUBLISH_SYNTHESIS': {
        const revision = await publishEventProjection(eventId, actor)
        result = success({ revision }, `공개 리비전 ${revision}을 발행했습니다.`)
        break
      }
      case 'SET_EXHIBITION_PUBLISHED': {
        const published = requiredBoolean(command, 'published')
        const eventRef = db.doc(`events/${eventId}`)
        const transition = await db.runTransaction(async (transaction) => {
          const event = await transaction.get(eventRef)
          const slug = String(event.get('publicSlug') ?? '')
          if (!event.exists || !/^[a-z0-9-]{3,80}$/.test(slug)) {
            throw new HttpsError('failed-precondition', '전시 공개 설정을 확인해주세요.')
          }
          const now = Timestamp.now()
          const generation = Number(event.get('publicationGeneration') ?? 0) + 1
          transaction.update(eventRef, {
            exhibitionPublished: published,
            publicationGeneration: generation,
            updatedAt: now,
          })
          if (!published) {
            transaction.set(
              db.doc(`publicEvents/${slug}`),
              { exhibitionPublished: false, updatedAt: now },
              { merge: true },
            )
          }
          return { generation, slug }
        })
        try {
          const revision = await publishEventProjection(eventId, actor, {
            exhibitionPublished: published,
            generation: transition.generation,
          })
          result = success(
            { published, revision },
            published
              ? `개인 작품 전시를 리비전 ${revision}로 공개했습니다.`
              : `개인 작품 전시를 리비전 ${revision}에서 회수했습니다.`,
          )
        } catch (error) {
          const superseded = error instanceof HttpsError && error.code === 'aborted'
          if (published && !superseded) {
            await db.runTransaction(async (transaction) => {
              const current = await transaction.get(eventRef)
              if (
                Number(current.get('publicationGeneration') ?? 0) !== transition.generation
                || current.get('exhibitionPublished') !== true
              ) return
              transaction.update(eventRef, {
                exhibitionPublished: false,
                publicationGeneration: transition.generation + 1,
                updatedAt: Timestamp.now(),
              })
              transaction.set(
                db.doc(`publicEvents/${transition.slug}`),
                { exhibitionPublished: false, updatedAt: Timestamp.now() },
                { merge: true },
              )
            })
          }
          throw error
        }
        break
      }
      case 'RESET_DEMO':
        throw new HttpsError('failed-precondition', '운영 데이터는 클라이언 명령으로 초기화할 수 없습니다.')
      default:
        throw new HttpsError('invalid-argument', '지원하지 않는 명령입니다.')
    }

    if (actor.role === 'owner' || actor.role === 'admin') {
      await appendAuditLog({
        action: `event.command.${type.toLowerCase()}`,
        actor,
        eventId,
        metadata: { commandType: type },
      })
    }
    return result
}

const commandOptions = {
  ...FUNCTION_COST_GUARDRAILS,
  region: REGION,
  enforceAppCheck: true,
  serviceAccount: CORE_RUNTIME_SERVICE_ACCOUNT,
  timeoutSeconds: 60,
} as const

export const applyEventCommand = onCall(commandOptions, executeCommand)
export const applyReviewCommand = onCall(commandOptions, executeCommand)
