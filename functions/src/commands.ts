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
  isVerifiedGoogleIdentity,
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
const MAX_LIVE_CHAT_MESSAGES_PER_PARTICIPANT_PER_SLIDE = 30
const MIN_LIVE_CHAT_INTERVAL_MS = 1_500
const MAX_SLIDES = 12
const MAX_SLIDE_INPUT_FIELDS = 6
const COMMAND_WINDOW_MS = 60_000
const ALLOWED_SLIDE_ILLUSTRATIONS = new Set([
  '/assets/illustrations/cat-exhibition.webp',
  '/assets/illustrations/cat-ideation.webp',
  '/assets/illustrations/cat-lobby.webp',
  '/assets/illustrations/cat-submission.webp',
  '/assets/illustrations/cat-timer.webp',
])
const LIVE_REACTION_KINDS = new Set(['like', 'love', 'idea', 'question'])
const commandBuckets = new Map<string, { count: number; window: number }>()

function slideInputFields(input: UnknownRecord): UnknownRecord[] {
  const raw = input.inputFields
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.length > MAX_SLIDE_INPUT_FIELDS) {
    throw new HttpsError('invalid-argument', `입력 블록은 최대 ${MAX_SLIDE_INPUT_FIELDS}개까지 만들 수 있습니다.`)
  }
  const labels = new Set<string>()
  return raw.map((candidate, index) => {
    const field = asRecord(candidate, `${index + 1}번째 입력 블록`)
    const id = requiredString(field, 'id', { max: 80, label: '입력 블록 ID' })
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      throw new HttpsError('invalid-argument', '입력 블록 ID 형식을 확인해주세요.')
    }
    const type = requiredString(field, 'type', { max: 12, label: '입력 유형' })
    if (type !== 'text' && type !== 'number') {
      throw new HttpsError('invalid-argument', '지원하지 않는 입력 유형입니다.')
    }
    const label = requiredString(field, 'label', { max: 80, label: '입력 이름' })
    const normalizedLabel = label.toLocaleLowerCase('ko-KR')
    if (labels.has(normalizedLabel)) {
      throw new HttpsError('invalid-argument', '입력 블록 이름은 서로 달라야 합니다.')
    }
    labels.add(normalizedLabel)
    const placeholder = optionalString(field, 'placeholder', 100)
    const x = requiredInteger(field, 'x', 0, 76)
    const y = requiredInteger(field, 'y', 30, 88)
    const width = requiredInteger(field, 'width', 24, 100)
    const height = requiredInteger(field, 'height', 12, 70)
    if (x + width > 100 || y + height > 100) {
      throw new HttpsError('invalid-argument', '입력 블록이 슬라이드 영역을 벗어났습니다.')
    }
    return { id, type, label, placeholder, required: field.required === true, x, y, width, height }
  })
}

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
  if (live.get('sessionStatus') !== 'live') {
    throw new HttpsError('failed-precondition', '주최자가 세션을 시작한 뒤 답변할 수 있습니다.')
  }
  const draftGraceUntil = live.get('draftGraceUntil')
  const withinPreviousSlideGrace = allowPreviousSlideGrace
    && live.get('previousSlideId') === slideId
    && draftGraceUntil instanceof Timestamp
    && draftGraceUntil.toMillis() > Date.now()
  if (live.get('activeSlideId') !== slideId && !withinPreviousSlideGrace) {
    throw new HttpsError('failed-precondition', '현재 진행 중인 질문에만 답변할 수 있습니다.')
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
        lifecycle: 'live',
        registrationClosedAt: null,
        registrationOpen: true,
        updatedAt: next.updatedAt,
      }, { merge: true })
    }
    const publicPatch: Record<string, unknown> = {
      'join.live': publicLiveProjection(next),
      'join.updatedAt': next.updatedAt,
    }
    if (type === 'START_TIMER' || type === 'RESUME_TIMER') {
      publicPatch['join.room.lifecycle'] = 'live'
    }
    transaction.update(db.doc(publicRootPath), publicPatch)
    return next
  })
  const notice = type === 'PAUSE_TIMER'
    ? '타이머를 일시정지했습니다.'
    : type === 'RESET_TIMER'
      ? '타이머를 초기화했습니다.'
      : '타이머를 시작했습니다.'
  return success(value, notice)
}

async function startSession(
  eventId: string,
  actor: EventActor,
): Promise<CommandSuccess> {
  const { publicRootPath } = await eventAndPublicRoot(eventId)
  const eventRef = db.doc(`events/${eventId}`)
  const liveRef = db.doc(eventPath(eventId, 'live/state'))
  const publicRootRef = db.doc(publicRootPath)
  const firstSlideQuery = db.collection(eventPath(eventId, 'slides')).orderBy('order', 'asc').limit(1)
  const value = await db.runTransaction(async (transaction) => {
    const [event, live, firstSlides] = await Promise.all([
      transaction.get(eventRef),
      transaction.get(liveRef),
      transaction.get(firstSlideQuery),
    ])
    if (!event.exists || !live.exists) {
      throw new HttpsError('not-found', '세션 진행 정보를 찾을 수 없습니다.')
    }
    if (event.get('lifecycle') === 'live') {
      return live.data()
    }
    if (event.get('lifecycle') !== 'lobby') {
      throw new HttpsError('failed-precondition', '입장 대기 중인 세션만 시작할 수 있습니다.')
    }
    const firstSlide = firstSlides.docs[0]
    if (!firstSlide?.exists) throw new HttpsError('not-found', '시작할 첫 슬라이드를 찾을 수 없습니다.')

    const now = Timestamp.now()
    const durationSec = Number(firstSlide.get('durationSec') ?? 0)
    if (!Number.isInteger(durationSec) || durationSec < 60) {
      throw new HttpsError('failed-precondition', '첫 슬라이드의 시간을 확인해주세요.')
    }
    const next = {
      ...live.data(),
      activeSlideId: firstSlide.id,
      activeSlideIndex: 0,
      previousSlideId: null,
      draftGraceUntil: null,
      sessionStatus: 'live',
      timerStatus: 'running',
      durationSec,
      remainingSec: durationSec,
      endsAt: Timestamp.fromMillis(now.toMillis() + durationSec * 1_000),
      startedAt: now,
      revision: revisionOf(live),
      updatedAt: now,
      updatedBy: actor.uid,
    }
    transaction.set(liveRef, next)
    transaction.set(eventRef, {
      lifecycle: 'live',
      registrationClosedAt: null,
      registrationOpen: true,
      updatedAt: now,
    }, { merge: true })
    transaction.update(
      publicRootRef,
      'join.live', publicLiveProjection(next),
      'join.room.lifecycle', 'live',
      'join.updatedAt', now,
    )
    return next
  })
  return success(value, '세션을 시작하고 참여자 화면에 첫 슬라이드를 열었습니다.')
}

async function setTimerDuration(
  eventId: string,
  command: UnknownRecord,
  actor: EventActor,
): Promise<CommandSuccess> {
  const durationSec = requiredInteger(command, 'durationSec', 60, 10_800)
  const { publicRootPath } = await eventAndPublicRoot(eventId)
  const liveRef = db.doc(eventPath(eventId, 'live/state'))
  const publicRootRef = db.doc(publicRootPath)
  const value = await db.runTransaction(async (transaction) => {
    const [live, publicRoot] = await Promise.all([
      transaction.get(liveRef),
      transaction.get(publicRootRef),
    ])
    if (!live.exists || !publicRoot.exists) {
      throw new HttpsError('not-found', '타이머를 변경할 행사 정보를 찾을 수 없습니다.')
    }
    if (live.get('timerStatus') === 'running') {
      throw new HttpsError('failed-precondition', '진행 중인 타이머를 일시정지한 뒤 시간을 변경해주세요.')
    }
    const slideId = safeDocumentId(String(live.get('activeSlideId') ?? ''), '슬라이드 ID')
    const slideRef = db.doc(eventPath(eventId, `slides/${slideId}`))
    const slide = await transaction.get(slideRef)
    if (!slide.exists) throw new HttpsError('not-found', '현재 슬라이드를 찾을 수 없습니다.')

    const now = Timestamp.now()
    const eyebrow = String(slide.get('eyebrow') ?? '').replace(
      /·\s*\d+\s*분\s*$/u,
      `· ${Math.round(durationSec / 60)}분`,
    )
    const slidePatch = { durationSec, eyebrow }
    const next = {
      ...live.data(),
      durationSec,
      remainingSec: durationSec,
      timerStatus: 'idle',
      endsAt: null,
      revision: revisionOf(live),
      updatedAt: now,
      updatedBy: actor.uid,
    }
    const join = publicRoot.get('join') as { slides?: Array<Record<string, unknown>> } | undefined
    const slides = Array.isArray(join?.slides)
      ? join.slides.map((item) => item.id === slideId ? { ...item, ...slidePatch } : item)
      : []
    if (!slides.some((item) => item.id === slideId)) {
      throw new HttpsError('failed-precondition', '공개 참여 화면의 슬라이드 정보를 찾을 수 없습니다.')
    }
    transaction.set(liveRef, next)
    transaction.update(slideRef, { ...slidePatch, updatedAt: now, updatedBy: actor.uid })
    transaction.update(
      publicRootRef,
      'join.live', publicLiveProjection(next),
      'join.slides', slides,
      'join.updatedAt', now,
    )
    return { durationSec, remainingSec: durationSec, slideId, timerStatus: 'idle' }
  })
  return success(value, `현재 단계 타이머를 ${Math.round(durationSec / 60)}분으로 설정했습니다.`)
}

async function updateSlideContent(
  eventId: string,
  command: UnknownRecord,
  actor: EventActor,
): Promise<CommandSuccess> {
  const input = commandInput(command, '슬라이드')
  const slideId = safeDocumentId(requiredString(input, 'slideId', { max: 128 }), '슬라이드 ID')
  const contentPatch = {
    eyebrow: requiredString(input, 'eyebrow', { max: 80, label: '단계 이름' }),
    title: requiredString(input, 'title', { max: 160, label: '슬라이드 제목' }),
    prompt: requiredString(input, 'prompt', { max: 800, label: '참여자 질문' }),
    helper: optionalString(input, 'helper', 500),
  }
  const nextInputFields = input.inputFields === undefined ? null : slideInputFields(input)
  const { publicRootPath } = await eventAndPublicRoot(eventId)
  const slideRef = db.doc(eventPath(eventId, `slides/${slideId}`))
  const publicRootRef = db.doc(publicRootPath)
  const value = await db.runTransaction(async (transaction) => {
    const [slide, publicRoot] = await Promise.all([
      transaction.get(slideRef),
      transaction.get(publicRootRef),
    ])
    if (!slide.exists || !publicRoot.exists) {
      throw new HttpsError('not-found', '편집할 슬라이드 정보를 찾을 수 없습니다.')
    }
    const patch: UnknownRecord = {
      ...contentPatch,
      inputFields: nextInputFields ?? (Array.isArray(slide.get('inputFields')) ? slide.get('inputFields') : []),
    }
    const join = publicRoot.get('join') as { slides?: Array<Record<string, unknown>> } | undefined
    const slides = Array.isArray(join?.slides)
      ? join.slides.map((item) => item.id === slideId ? { ...item, ...patch } : item)
      : []
    if (!slides.some((item) => item.id === slideId)) {
      throw new HttpsError('failed-precondition', '공개 참여 화면의 슬라이드 정보를 찾을 수 없습니다.')
    }
    const updatedAt = Timestamp.now()
    transaction.update(slideRef, { ...patch, updatedAt, updatedBy: actor.uid })
    transaction.update(publicRootRef, 'join.slides', slides, 'join.updatedAt', updatedAt)
    return { id: slideId, ...patch }
  })
  return success(value, '슬라이드 내용을 모든 참여자 화면에 반영했습니다.')
}

async function createSlide(
  eventId: string,
  command: UnknownRecord,
  actor: EventActor,
): Promise<CommandSuccess> {
  const input = commandInput(command, '새 슬라이드')
  const durationSec = requiredInteger(input, 'durationSec', 60, 10_800)
  const illustration = requiredString(input, 'illustration', { max: 180, label: '삽화' })
  if (!ALLOWED_SLIDE_ILLUSTRATIONS.has(illustration)) {
    throw new HttpsError('invalid-argument', '사용할 수 없는 슬라이드 삽화입니다.')
  }
  const content = {
    eyebrow: requiredString(input, 'eyebrow', { max: 80, label: '단계 이름' }),
    title: requiredString(input, 'title', { max: 160, label: '슬라이드 제목' }),
    prompt: requiredString(input, 'prompt', { max: 800, label: '참여자 질문' }),
    helper: optionalString(input, 'helper', 500),
    inputFields: slideInputFields(input),
  }
  const { publicRootPath } = await eventAndPublicRoot(eventId)
  const slidesCollection = db.collection(eventPath(eventId, 'slides'))
  const newSlideRef = slidesCollection.doc()
  const publicRootRef = db.doc(publicRootPath)
  const value = await db.runTransaction(async (transaction) => {
    const [slideRecords, publicRoot] = await Promise.all([
      transaction.get(slidesCollection.orderBy('order', 'asc')),
      transaction.get(publicRootRef),
    ])
    if (!publicRoot.exists) throw new HttpsError('not-found', '참여 화면 정보를 찾을 수 없습니다.')
    if (slideRecords.size >= MAX_SLIDES) {
      throw new HttpsError('resource-exhausted', `슬라이드는 최대 ${MAX_SLIDES}개까지 만들 수 있습니다.`)
    }
    const now = Timestamp.now()
    const created = {
      id: newSlideRef.id,
      order: slideRecords.size + 1,
      ...content,
      durationSec,
      illustration,
      answersRevealed: false,
      commentsEnabled: false,
    }
    const join = publicRoot.get('join') as { slides?: Array<Record<string, unknown>> } | undefined
    if (!Array.isArray(join?.slides)) {
      throw new HttpsError('failed-precondition', '공개 참여 화면의 슬라이드 목록을 찾을 수 없습니다.')
    }
    transaction.create(newSlideRef, { ...created, createdAt: now, updatedAt: now, updatedBy: actor.uid })
    transaction.update(
      publicRootRef,
      'join.slides', [...join.slides, created],
      'join.updatedAt', now,
    )
    return created
  })
  return success(value, '새 슬라이드를 덱 마지막에 추가했습니다.')
}

async function deleteSlide(
  eventId: string,
  command: UnknownRecord,
  actor: EventActor,
): Promise<CommandSuccess> {
  const slideId = safeDocumentId(requiredString(command, 'slideId', { max: 128 }), '슬라이드 ID')
  const { publicRootPath } = await eventAndPublicRoot(eventId)
  const slidesCollection = db.collection(eventPath(eventId, 'slides'))
  const slideRef = slidesCollection.doc(slideId)
  const liveRef = db.doc(eventPath(eventId, 'live/state'))
  const publicRootRef = db.doc(publicRootPath)
  const value = await db.runTransaction(async (transaction) => {
    const [slideRecords, live, publicRoot, answers, drafts] = await Promise.all([
      transaction.get(slidesCollection.orderBy('order', 'asc')),
      transaction.get(liveRef),
      transaction.get(publicRootRef),
      transaction.get(db.collection(eventPath(eventId, 'answers')).where('slideId', '==', slideId).limit(1)),
      transaction.get(db.collection(eventPath(eventId, 'answerDrafts')).where('slideId', '==', slideId).limit(1)),
    ])
    const deletingIndex = slideRecords.docs.findIndex((slide) => slide.id === slideId)
    if (deletingIndex < 0) throw new HttpsError('not-found', '삭제할 슬라이드를 찾을 수 없습니다.')
    if (!live.exists || !publicRoot.exists) throw new HttpsError('not-found', '행사 진행 정보를 찾을 수 없습니다.')
    if (slideRecords.size <= 1) throw new HttpsError('failed-precondition', '행사에는 슬라이드가 하나 이상 필요합니다.')
    if (live.get('activeSlideId') === slideId && live.get('timerStatus') === 'running') {
      throw new HttpsError('failed-precondition', '진행 중인 슬라이드는 타이머를 일시정지한 뒤 삭제해주세요.')
    }
    if (!answers.empty || !drafts.empty) {
      throw new HttpsError('failed-precondition', '참여자 답변이 있는 슬라이드는 삭제할 수 없습니다.')
    }

    const remaining = slideRecords.docs.filter((slide) => slide.id !== slideId)
    const publicJoin = publicRoot.get('join') as { slides?: Array<Record<string, unknown>> } | undefined
    if (!Array.isArray(publicJoin?.slides)) {
      throw new HttpsError('failed-precondition', '공개 참여 화면의 슬라이드 목록을 찾을 수 없습니다.')
    }
    const publicById = new Map(publicJoin.slides.map((slide) => [String(slide.id ?? ''), slide]))
    const publicSlides = remaining.map((slide, index) => ({
      ...(publicById.get(slide.id) ?? slide.data()),
      id: slide.id,
      order: index + 1,
    }))
    const currentActiveId = String(live.get('activeSlideId') ?? '')
    const activeWasDeleted = currentActiveId === slideId
    const fallback = activeWasDeleted
      ? remaining[Math.min(deletingIndex, remaining.length - 1)]!
      : remaining.find((slide) => slide.id === currentActiveId) ?? remaining[0]!
    const activeSlideIndex = remaining.findIndex((slide) => slide.id === fallback.id)
    const now = Timestamp.now()
    const nextLive = {
      ...live.data(),
      activeSlideId: fallback.id,
      activeSlideIndex,
      ...(activeWasDeleted ? {
        previousSlideId: slideId,
        timerStatus: 'idle',
        durationSec: Number(fallback.get('durationSec') ?? 0),
        remainingSec: Number(fallback.get('durationSec') ?? 0),
        endsAt: null,
      } : {}),
      revision: revisionOf(live),
      updatedAt: now,
      updatedBy: actor.uid,
    }
    transaction.delete(slideRef)
    remaining.forEach((slide, index) => {
      if (Number(slide.get('order') ?? 0) !== index + 1) {
        transaction.update(slide.ref, { order: index + 1, updatedAt: now, updatedBy: actor.uid })
      }
    })
    transaction.set(liveRef, nextLive)
    transaction.update(
      publicRootRef,
      'join.slides', publicSlides,
      'join.live', publicLiveProjection(nextLive),
      'join.updatedAt', now,
    )
    return { activeSlideId: fallback.id, deletedSlideId: slideId }
  })
  return success(value, '슬라이드를 삭제하고 덱 순서를 다시 정리했습니다.')
}

async function moveSlide(
  eventId: string,
  command: UnknownRecord,
  actor: EventActor,
): Promise<CommandSuccess> {
  const slideId = safeDocumentId(requiredString(command, 'slideId', { max: 128 }), '슬라이드 ID')
  const direction = requiredString(command, 'direction', { max: 8, label: '이동 방향' })
  if (direction !== 'up' && direction !== 'down') {
    throw new HttpsError('invalid-argument', '슬라이드 이동 방향을 확인해주세요.')
  }
  const { publicRootPath } = await eventAndPublicRoot(eventId)
  const slidesCollection = db.collection(eventPath(eventId, 'slides'))
  const liveRef = db.doc(eventPath(eventId, 'live/state'))
  const publicRootRef = db.doc(publicRootPath)
  const value = await db.runTransaction(async (transaction) => {
    const [slideRecords, live, publicRoot] = await Promise.all([
      transaction.get(slidesCollection.orderBy('order', 'asc')),
      transaction.get(liveRef),
      transaction.get(publicRootRef),
    ])
    if (!live.exists || !publicRoot.exists) throw new HttpsError('not-found', '행사 진행 정보를 찾을 수 없습니다.')
    const sourceIndex = slideRecords.docs.findIndex((slide) => slide.id === slideId)
    if (sourceIndex < 0) throw new HttpsError('not-found', '이동할 슬라이드를 찾을 수 없습니다.')
    const targetIndex = sourceIndex + (direction === 'up' ? -1 : 1)
    if (!slideRecords.docs[targetIndex]) {
      throw new HttpsError('failed-precondition', '슬라이드를 더 이동할 수 없습니다.')
    }
    const reordered = [...slideRecords.docs]
    ;[reordered[sourceIndex], reordered[targetIndex]] = [reordered[targetIndex]!, reordered[sourceIndex]!]
    const publicJoin = publicRoot.get('join') as { slides?: Array<Record<string, unknown>> } | undefined
    if (!Array.isArray(publicJoin?.slides)) {
      throw new HttpsError('failed-precondition', '공개 참여 화면의 슬라이드 목록을 찾을 수 없습니다.')
    }
    const publicById = new Map(publicJoin.slides.map((slide) => [String(slide.id ?? ''), slide]))
    const publicSlides = reordered.map((slide, index) => ({
      ...(publicById.get(slide.id) ?? slide.data()),
      id: slide.id,
      order: index + 1,
    }))
    const activeSlideId = String(live.get('activeSlideId') ?? '')
    const now = Timestamp.now()
    const nextLive = {
      ...live.data(),
      activeSlideIndex: Math.max(0, reordered.findIndex((slide) => slide.id === activeSlideId)),
      revision: revisionOf(live),
      updatedAt: now,
      updatedBy: actor.uid,
    }
    reordered.forEach((slide, index) => {
      if (Number(slide.get('order') ?? 0) !== index + 1) {
        transaction.update(slide.ref, { order: index + 1, updatedAt: now, updatedBy: actor.uid })
      }
    })
    transaction.set(liveRef, nextLive)
    transaction.update(
      publicRootRef,
      'join.slides', publicSlides,
      'join.live', publicLiveProjection(nextLive),
      'join.updatedAt', now,
    )
    return { direction, slideId, targetIndex }
  })
  return success(value, '슬라이드 순서를 변경했습니다.')
}

async function reorderSlides(
  eventId: string,
  command: UnknownRecord,
  actor: EventActor,
): Promise<CommandSuccess> {
  const orderedSlideIds = stringArray(command.orderedSlideIds, MAX_SLIDES, 128)
    .map((slideId) => safeDocumentId(slideId, '슬라이드 ID'))
  if (new Set(orderedSlideIds).size !== orderedSlideIds.length) {
    throw new HttpsError('invalid-argument', '중복된 슬라이드가 있어 순서를 저장할 수 없습니다.')
  }
  const { publicRootPath } = await eventAndPublicRoot(eventId)
  const slidesCollection = db.collection(eventPath(eventId, 'slides'))
  const liveRef = db.doc(eventPath(eventId, 'live/state'))
  const publicRootRef = db.doc(publicRootPath)
  const value = await db.runTransaction(async (transaction) => {
    const [records, live, publicRoot] = await Promise.all([
      transaction.get(slidesCollection.orderBy('order', 'asc')),
      transaction.get(liveRef),
      transaction.get(publicRootRef),
    ])
    if (!live.exists || !publicRoot.exists) throw new HttpsError('not-found', '행사 진행 정보를 찾을 수 없습니다.')
    const currentIds = records.docs.map((slide) => slide.id)
    if (
      orderedSlideIds.length !== currentIds.length
      || currentIds.some((slideId) => !orderedSlideIds.includes(slideId))
    ) {
      throw new HttpsError('failed-precondition', '슬라이드 목록이 변경되었습니다. 새로고침 후 다시 정렬해주세요.')
    }
    const byId = new Map(records.docs.map((slide) => [slide.id, slide]))
    const publicJoin = publicRoot.get('join') as { slides?: Array<Record<string, unknown>> } | undefined
    if (!Array.isArray(publicJoin?.slides)) {
      throw new HttpsError('failed-precondition', '공개 참여 화면의 슬라이드 목록을 찾을 수 없습니다.')
    }
    const publicById = new Map(publicJoin.slides.map((slide) => [String(slide.id ?? ''), slide]))
    const now = Timestamp.now()
    const publicSlides = orderedSlideIds.map((slideId, index) => ({
      ...(publicById.get(slideId) ?? byId.get(slideId)!.data()),
      id: slideId,
      order: index + 1,
    }))
    orderedSlideIds.forEach((slideId, index) => {
      const slide = byId.get(slideId)!
      if (Number(slide.get('order') ?? 0) !== index + 1) {
        transaction.update(slide.ref, { order: index + 1, updatedAt: now, updatedBy: actor.uid })
      }
    })
    const activeSlideId = String(live.get('activeSlideId') ?? '')
    const nextLive = {
      ...live.data(),
      activeSlideIndex: Math.max(0, orderedSlideIds.indexOf(activeSlideId)),
      revision: revisionOf(live),
      updatedAt: now,
      updatedBy: actor.uid,
    }
    transaction.set(liveRef, nextLive)
    transaction.update(
      publicRootRef,
      'join.slides', publicSlides,
      'join.live', publicLiveProjection(nextLive),
      'join.updatedAt', now,
    )
    return { activeSlideId, orderedSlideIds }
  })
  return success(value, '슬라이드 순서를 저장했습니다.')
}

async function endSession(
  eventId: string,
  actor: EventActor,
): Promise<CommandSuccess> {
  const { event, publicRootPath } = await eventAndPublicRoot(eventId)
  if (event.get('lifecycle') === 'ended') return success({ eventId }, '이미 종료된 세션입니다.')
  const eventRef = db.doc(`events/${eventId}`)
  const liveRef = db.doc(eventPath(eventId, 'live/state'))
  const publicRootRef = db.doc(publicRootPath)
  const membersQuery = db.collection(eventPath(eventId, 'members'))
  const participantsQuery = db.collection(eventPath(eventId, 'participants'))
  const value = await db.runTransaction(async (transaction) => {
    const [eventSnapshot, live, publicRoot, members, participants] = await Promise.all([
      transaction.get(eventRef),
      transaction.get(liveRef),
      transaction.get(publicRootRef),
      transaction.get(membersQuery),
      transaction.get(participantsQuery),
    ])
    if (!eventSnapshot.exists || !live.exists || !publicRoot.exists) {
      throw new HttpsError('not-found', '종료할 세션 정보를 찾을 수 없습니다.')
    }
    const now = Timestamp.now()
    const nextLive = {
      ...live.data(),
      sessionStatus: 'ended',
      timerStatus: 'complete',
      remainingSec: 0,
      endsAt: null,
      revision: revisionOf(live),
      updatedAt: now,
      updatedBy: actor.uid,
    }
    transaction.update(eventRef, {
      lifecycle: 'ended',
      registrationOpen: false,
      endedAt: now,
      endedBy: actor.uid,
      updatedAt: now,
    })
    transaction.set(liveRef, nextLive)
    transaction.update(
      publicRootRef,
      'join.live', publicLiveProjection(nextLive),
      'join.room.lifecycle', 'ended',
      'join.updatedAt', now,
    )
    members.docs.forEach((member) => {
      const participant = member.get('role') === 'participant'
      transaction.set(member.ref, {
        ...(participant ? { status: 'disabled' } : {}),
        updatedAt: now,
      }, { merge: true })
      transaction.set(db.doc(`users/${member.id}/memberships/${eventId}`), {
        lifecycle: 'ended',
        updatedAt: now,
      }, { merge: true })
    })
    participants.docs.forEach((participant) => transaction.set(participant.ref, {
      membershipStatus: 'disabled',
      lastSeenAt: now,
    }, { merge: true }))
    return { eventId, participantCount: participants.size }
  })
  await appendAuditLog({ action: 'event.session.end', actor, eventId, metadata: value })
  return success(value, '세션을 종료하고 참여자 연결을 닫았습니다.')
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
      visibility: slide.get('answersRevealed') === true ? 'revealed' : 'owner',
      createdAt: existingAnswer.get('createdAt') ?? now,
      updatedAt: now,
      submittedAt: now,
    }
    transaction.set(answerRef, answer)
    return answer
  })
  return success(value, input.submit === false ? '답변 초안을 저장했습니다.' : '개인 답변을 제출했습니다.')
}

function assertLiveInteractionWindow(
  event: DocumentSnapshot,
  live: DocumentSnapshot,
  slideId: string,
): void {
  if (!event.exists || !live.exists) {
    throw new HttpsError('not-found', '라이브 세션 정보를 찾을 수 없습니다.')
  }
  if (event.get('lifecycle') !== 'live' || live.get('sessionStatus') !== 'live') {
    throw new HttpsError('failed-precondition', '세션 진행 중에만 반응과 채팅을 보낼 수 있습니다.')
  }
  if (live.get('activeSlideId') !== slideId) {
    throw new HttpsError('failed-precondition', '현재 진행 중인 슬라이드에만 반응과 채팅을 보낼 수 있습니다.')
  }
}

async function setLiveReaction(
  eventId: string,
  command: UnknownRecord,
  actor: EventActor & { role: 'participant' },
): Promise<CommandSuccess> {
  const input = commandInput(command, '라이브 반응')
  const slideId = safeDocumentId(requiredString(input, 'slideId', { max: 128 }), '슬라이드 ID')
  const rawKind = input.kind
  if (rawKind !== null && (typeof rawKind !== 'string' || !LIVE_REACTION_KINDS.has(rawKind))) {
    throw new HttpsError('invalid-argument', '라이브 반응 종류를 확인해주세요.')
  }
  const eventRef = db.doc(`events/${eventId}`)
  const liveRef = db.doc(eventPath(eventId, 'live/state'))
  const reactionRef = db.doc(eventPath(eventId, `liveReactions/${slideId}__${actor.uid}`))
  const value = await db.runTransaction(async (transaction) => {
    const [event, live] = await Promise.all([
      transaction.get(eventRef),
      transaction.get(liveRef),
    ])
    assertLiveInteractionWindow(event, live, slideId)
    if (rawKind === null) {
      transaction.delete(reactionRef)
      return { kind: null, slideId }
    }
    const updatedAt = Timestamp.now()
    transaction.set(reactionRef, {
      kind: rawKind,
      ownerParticipantId: actor.uid,
      participantId: actor.uid,
      slideId,
      updatedAt,
    })
    return { id: reactionRef.id, kind: rawKind, slideId, updatedAt: updatedAt.toDate().toISOString() }
  })
  return success(value, rawKind === null ? '반응을 취소했습니다.' : '반응을 보냈습니다.')
}

async function sendLiveChatMessage(
  eventId: string,
  command: UnknownRecord,
  actor: EventActor & { role: 'participant' },
): Promise<CommandSuccess> {
  const input = commandInput(command, '라이브 채팅')
  const slideId = safeDocumentId(requiredString(input, 'slideId', { max: 128 }), '슬라이드 ID')
  const body = requiredString(input, 'body', { min: 1, max: 280, label: '라이브 채팅' })
  const eventRef = db.doc(`events/${eventId}`)
  const liveRef = db.doc(eventPath(eventId, 'live/state'))
  const limitRef = db.doc(eventPath(eventId, `liveInteractionLimits/${slideId}__${actor.uid}`))
  const messageRef = db.collection(eventPath(eventId, 'liveChatMessages')).doc()
  const value = await db.runTransaction(async (transaction) => {
    const [event, live, limit] = await Promise.all([
      transaction.get(eventRef),
      transaction.get(liveRef),
      transaction.get(limitRef),
    ])
    assertLiveInteractionWindow(event, live, slideId)
    const now = Timestamp.now()
    const lastSentAt = limit.get('lastSentAt')
    if (lastSentAt instanceof Timestamp && now.toMillis() - lastSentAt.toMillis() < MIN_LIVE_CHAT_INTERVAL_MS) {
      throw new HttpsError('resource-exhausted', '채팅은 잠시 간격을 두고 보내주세요.')
    }
    const count = Number(limit.get('count') ?? 0)
    if (count >= MAX_LIVE_CHAT_MESSAGES_PER_PARTICIPANT_PER_SLIDE) {
      throw new HttpsError('resource-exhausted', '이 단계에서 보낼 수 있는 채팅 수에 도달했습니다.')
    }
    transaction.set(limitRef, { count: count + 1, lastSentAt: now, updatedAt: now }, { merge: true })
    transaction.create(messageRef, {
      body,
      createdAt: now,
      ownerParticipantId: actor.uid,
      participantId: actor.uid,
      slideId,
      visibility: 'event',
    })
    return { body, createdAt: now.toDate().toISOString(), id: messageRef.id, slideId }
  })
  return success(value, '라이브 채팅을 보냈습니다.')
}

async function deleteLiveChatMessage(
  eventId: string,
  command: UnknownRecord,
  actor: EventActor,
): Promise<CommandSuccess> {
  const input = commandInput(command, '라이브 채팅 삭제')
  const messageId = safeDocumentId(requiredString(input, 'messageId', { max: 128 }), '메시지 ID')
  const messageRef = db.doc(eventPath(eventId, `liveChatMessages/${messageId}`))
  const message = await messageRef.get()
  if (!message.exists) throw new HttpsError('not-found', '채팅 메시지를 찾을 수 없습니다.')
  if (actor.role !== 'owner' && actor.role !== 'admin') {
    throw new HttpsError('permission-denied', '주최자만 라이브 채팅을 관리할 수 있습니다.')
  }
  await messageRef.delete()
  await appendAuditLog({
    action: 'live.chat.delete',
    actor,
    eventId,
    metadata: { messageId, participantId: message.get('participantId'), slideId: message.get('slideId') },
  })
  return success({ id: messageId }, '채팅 메시지를 삭제했습니다.')
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
  const requestedCoverImage = optionalString(input, 'coverImage', 2_000)
  const coverImage = requestedCoverImage && !ALLOWED_SLIDE_ILLUSTRATIONS.has(requestedCoverImage)
    ? optionalWebUrl(requestedCoverImage)
    : requestedCoverImage
  if (coverImage && !ALLOWED_SLIDE_ILLUSTRATIONS.has(coverImage) && !coverImage.startsWith('https://')) {
    throw new HttpsError('invalid-argument', '대표 이미지는 HTTPS 주소를 사용해주세요.')
  }
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
    coverImage: coverImage || '/assets/illustrations/cat-submission.webp',
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
  if (!isVerifiedGoogleIdentity(signedIn.token)) {
    throw new HttpsError('permission-denied', '초대받은 Google 이메일 계정으로 로그인해주세요.')
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
  'SEND_LIVE_CHAT_MESSAGE',
  'SAVE_ANSWER',
  'SET_LIVE_REACTION',
  'SUBMIT_ANSWER',
  'SUBMIT_PROJECT',
  'UPDATE_COMMENT',
])
const organizerCommands = new Set([
  'ADD_REVIEW_THREAD',
  'CREATE_SLIDE',
  'DELETE_SLIDE',
  'MOVE_SLIDE',
  'REORDER_SLIDES',
  'END_SESSION',
  'DELETE_LIVE_CHAT_MESSAGE',
  'PAUSE_TIMER',
  'PUBLISH_SYNTHESIS',
  'RESET_TIMER',
  'RESUME_TIMER',
  'SET_ACTIVE_SLIDE',
  'SET_ANSWERS_REVEALED',
  'SET_COMMENTS_ENABLED',
  'SET_EXHIBITION_PUBLISHED',
  'SET_PARTICIPANT_STATUS',
  'SET_TIMER_DURATION',
  'START_SESSION',
  'START_TIMER',
  'UPDATE_SLIDE',
  'UPDATE_SYNTHESIS',
])
const ownerCommands = new Set(['INVITE_ADMIN', 'REVOKE_ADMIN'])
const closedSessionCommands = new Set([
  'CREATE_SLIDE',
  'DELETE_SLIDE',
  'MOVE_SLIDE',
  'REORDER_SLIDES',
  'PAUSE_TIMER',
  'RESET_TIMER',
  'RESUME_TIMER',
  'SET_ACTIVE_SLIDE',
  'SET_ANSWERS_REVEALED',
  'SET_COMMENTS_ENABLED',
  'SET_TIMER_DURATION',
  'START_SESSION',
  'START_TIMER',
  'UPDATE_SLIDE',
])

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
    if (closedSessionCommands.has(type)) {
      const event = await db.doc(`events/${eventId}`).get()
      if (event.get('lifecycle') === 'ended') {
        throw new HttpsError('failed-precondition', '종료된 세션의 진행 화면은 변경할 수 없습니다.')
      }
    }

    let result: CommandSuccess
    switch (type) {
      case 'SET_PARTICIPANT_STATUS': {
        const targetUid = safeDocumentId(requiredString(command, 'participantId', { max: 128 }), '참여자 ID')
        const status = requiredString(command, 'status', { max: 16 })
        if (status !== 'online' && status !== 'offline') throw new HttpsError('invalid-argument', '참여 상태가 올바르지 않습니다.')
        await db.doc(eventPath(eventId, `participants/${targetUid}`)).update({
          status,
          lastSeenAt: Timestamp.now(),
        })
        await db.doc(eventPath(eventId, `participantDirectory/${targetUid}`)).set({
          status,
          lastSeenAt: Timestamp.now(),
        }, { merge: true })
        result = success({ id: targetUid, status }, '참여자 상태를 기록했습니다.')
        break
      }
      case 'SET_ACTIVE_SLIDE':
        result = await setActiveSlide(eventId, command, actor)
        break
      case 'CREATE_SLIDE':
        result = await createSlide(eventId, command, actor)
        break
      case 'DELETE_SLIDE':
        result = await deleteSlide(eventId, command, actor)
        break
      case 'MOVE_SLIDE':
        result = await moveSlide(eventId, command, actor)
        break
      case 'REORDER_SLIDES':
        result = await reorderSlides(eventId, command, actor)
        break
      case 'END_SESSION':
        result = await endSession(eventId, actor)
        break
      case 'SET_TIMER_DURATION':
        result = await setTimerDuration(eventId, command, actor)
        break
      case 'START_SESSION':
        result = await startSession(eventId, actor)
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
      case 'UPDATE_SLIDE':
        result = await updateSlideContent(eventId, command, actor)
        break
      case 'SAVE_ANSWER':
      case 'SUBMIT_ANSWER':
        result = await saveAnswer(eventId, command, actor as EventActor & { role: 'participant' })
        break
      case 'ADD_COMMENT':
        result = await addComment(eventId, command, actor as EventActor & { role: 'participant' })
        break
      case 'SET_LIVE_REACTION':
        result = await setLiveReaction(eventId, command, actor as EventActor & { role: 'participant' })
        break
      case 'SEND_LIVE_CHAT_MESSAGE':
        result = await sendLiveChatMessage(eventId, command, actor as EventActor & { role: 'participant' })
        break
      case 'DELETE_LIVE_CHAT_MESSAGE':
        result = await deleteLiveChatMessage(eventId, command, actor)
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
