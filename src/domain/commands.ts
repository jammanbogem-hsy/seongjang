import type {
  AddCommentInput,
  Answer,
  CommandErrorCode,
  CommandOutcome,
  CommandResult,
  Comment,
  LiveChatMessage,
  LiveReaction,
  PlatformCommand,
  PrototypeState,
  ReviewMessage,
  ReviewThread,
  Submission,
  SubmitProjectInput,
  TimerView,
} from './models'
import { createPublishedSnapshot } from './publicProjection'
import { createEmptyState, normalizeNickname } from './eventTemplate'

export interface CommandEnvironment {
  now: () => number
  createId: (prefix: string) => string
}

const defaultEnvironment: CommandEnvironment = {
  now: () => Date.now(),
  createId: (prefix) =>
    `${prefix}-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
}

function error(
  state: PrototypeState,
  code: CommandErrorCode,
  message: string,
): CommandOutcome {
  return { state, result: { ok: false, error: { code, message } } }
}

function success<T>(
  previous: PrototypeState,
  next: PrototypeState,
  value: T,
  notice?: string,
): CommandOutcome<T> {
  return {
    state: { ...next, revision: previous.revision + 1 },
    result: notice ? { ok: true, value, notice } : { ok: true, value },
  }
}

function isPin(value: string): boolean {
  return /^\d{4}$/.test(value)
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function isWebUrl(value: string): boolean {
  if (!value) return true
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

function iso(now: number): string {
  return new Date(now).toISOString()
}

function withTimerMinutes(eyebrow: string, durationSec: number): string {
  return eyebrow.replace(/·\s*\d+\s*분\s*$/u, `· ${Math.round(durationSec / 60)}분`)
}

export function getTimerView(timer: PrototypeState['live']['timer'], now = Date.now()): TimerView {
  const computedRemaining =
    timer.status === 'running' && timer.endsAt !== null
      ? Math.max(0, Math.ceil((timer.endsAt - now) / 1_000))
      : timer.remainingSec
  const remainingSec = Math.min(timer.durationSec, computedRemaining)
  const status = timer.status === 'running' && remainingSec === 0 ? 'complete' : timer.status
  return {
    remainingSec,
    status,
    progress: timer.durationSec === 0 ? 0 : remainingSec / timer.durationSec,
  }
}

function validateCommentGate(
  state: PrototypeState,
  input: Pick<AddCommentInput, 'answerId'>,
): CommandResult<{ answer: Answer }> {
  const answer = state.answers.find(
    (candidate) => candidate.id === input.answerId && candidate.status === 'submitted',
  )
  if (!answer) {
    return { ok: false, error: { code: 'NOT_FOUND', message: '댓글을 달 답변을 찾을 수 없어요.' } }
  }
  if (!state.live.answersRevealedBySlide[answer.slideId]) {
    return { ok: false, error: { code: 'NOT_ALLOWED', message: '답변 공개 후에 댓글을 달 수 있어요.' } }
  }
  if (!state.live.commentsEnabledBySlide[answer.slideId]) {
    return { ok: false, error: { code: 'NOT_ALLOWED', message: '주최자가 댓글을 열어두지 않았어요.' } }
  }
  return { ok: true, value: { answer } }
}

function validateSubmission(input: SubmitProjectInput): CommandResult<undefined> {
  if (!input.submit) return { ok: true, value: undefined }
  if (
    !input.title.trim() ||
    !input.pitch.trim() ||
    !input.description.trim() ||
    !input.retrospective.trim()
  ) {
    return {
      ok: false,
      error: { code: 'INVALID_SUBMISSION', message: '제목, 한 줄 소개, 설명과 회고를 모두 적어주세요.' },
    }
  }
  if (!input.demoUrl?.trim() && !input.githubUrl?.trim()) {
    return {
      ok: false,
      error: { code: 'INVALID_SUBMISSION', message: '데모 또는 GitHub 링크가 하나 이상 필요해요.' },
    }
  }
  if (!isWebUrl(input.demoUrl?.trim() ?? '') || !isWebUrl(input.githubUrl?.trim() ?? '')) {
    return {
      ok: false,
      error: { code: 'INVALID_SUBMISSION', message: '링크는 http 또는 https 주소로 입력해주세요.' },
    }
  }
  return { ok: true, value: undefined }
}

function reviewOwnerId(state: PrototypeState, thread: ReviewThread): string | null {
  if (thread.targetType === 'answer') {
    return state.answers.find((answer) => answer.id === thread.targetId)?.participantId ?? null
  }
  return state.submissions.find((submission) => submission.id === thread.targetId)?.participantId ?? null
}

function canAccessReviewThread(
  state: PrototypeState,
  thread: ReviewThread,
  authorRole: ReviewMessage['authorRole'],
  participantId?: string,
): boolean {
  if (authorRole === 'organizer') return true
  return Boolean(participantId && reviewOwnerId(state, thread) === participantId)
}

export function executePlatformCommand(
  state: PrototypeState,
  command: PlatformCommand,
  environment: Partial<CommandEnvironment> = {},
): CommandOutcome {
  const env = { ...defaultEnvironment, ...environment }
  const now = env.now()
  const nowIso = iso(now)

  switch (command.type) {
    case 'JOIN_PARTICIPANT': {
      const roomCode = command.input.roomCode.trim().toLocaleUpperCase()
      if (roomCode !== state.room.code.toLocaleUpperCase()) {
        return error(state, 'INVALID_ROOM', '방 코드를 다시 확인해주세요.')
      }
      const nickname = command.input.nickname.trim().replace(/\s+/g, ' ')
      const normalizedNickname = normalizeNickname(nickname)
      if (nickname.length < 2 || nickname.length > 16) {
        return error(state, 'INVALID_NICKNAME', '닉네임은 2자 이상 16자 이하로 입력해주세요.')
      }
      if (!isPin(command.input.pin)) {
        return error(state, 'INVALID_PIN', '개인 입장코드는 숫자 4자리여야 해요.')
      }
      const existing = state.participants.find(
        (participant) => participant.normalizedNickname === normalizedNickname,
      )
      if (existing) {
        if (command.input.entryMode === 'register') {
          return error(
            state,
            'NICKNAME_TAKEN',
            '이미 사용 중인 닉네임이에요. 이전 참여자라면 ‘다시 입장’을 선택해주세요.',
          )
        }
        if (existing.pin !== command.input.pin) {
          return error(state, 'PIN_MISMATCH', '닉네임은 맞지만 개인 입장코드가 일치하지 않아요. 관리자에게 문의해주세요.')
        }
        const reentered = { ...existing, eventId: existing.eventId ?? state.room.id, status: 'online' as const, lastSeenAt: nowIso }
        return success(
          state,
          {
            ...state,
            participants: state.participants.map((participant) =>
              participant.id === existing.id ? reentered : participant,
            ),
          },
          reentered,
          '닉네임과 개인 입장코드를 확인했어요. 이전 기록을 이어서 엽니다.',
        )
      }
      if (command.input.entryMode === 'reenter') {
        return error(
          state,
          'REENTRY_NOT_FOUND',
          '이 세션에 등록된 닉네임을 찾지 못했어요. 닉네임을 확인하거나 ‘처음 입장’을 선택해주세요.',
        )
      }
      if (state.room.lifecycle === 'live' || state.room.lifecycle === 'ended') {
        return error(state, 'NOT_ALLOWED', '신규 참여자 입장이 마감되었습니다. 기존 닉네임과 개인 입장코드로 다시 입장해주세요.')
      }
      if (state.participants.length >= state.room.capacity) {
        return error(state, 'ROOM_FULL', `이 방은 최대 ${state.room.capacity}명까지 참여할 수 있어요.`)
      }
      const created = {
        id: env.createId('participant'),
        eventId: state.room.id,
        nickname,
        normalizedNickname,
        pin: command.input.pin,
        joinedAt: nowIso,
        lastSeenAt: nowIso,
        status: 'online' as const,
        accent: '#3157C8',
      }
      return success(
        state,
        { ...state, participants: [...state.participants, created] },
        created,
        '닉네임과 개인 입장코드가 등록됐어요. 이 브라우저에 참여 정보를 기억할게요.',
      )
    }

    case 'SET_PARTICIPANT_STATUS': {
      const participant = state.participants.find(({ id }) => id === command.participantId)
      if (!participant) return error(state, 'NOT_FOUND', '참가자를 찾을 수 없어요.')
      const updated = { ...participant, status: command.status, lastSeenAt: nowIso }
      return success(
        state,
        {
          ...state,
          participants: state.participants.map((candidate) =>
            candidate.id === updated.id ? updated : candidate,
          ),
        },
        updated,
      )
    }

    case 'CREATE_SLIDE': {
      if (state.slides.length >= 12) {
        return error(state, 'NOT_ALLOWED', '슬라이드는 최대 12개까지 만들 수 있어요.')
      }
      const { input } = command
      const eyebrow = input.eyebrow.trim()
      const title = input.title.trim()
      const prompt = input.prompt.trim()
      const helper = input.helper.trim()
      if (!eyebrow || eyebrow.length > 80 || !title || title.length > 160) {
        return error(state, 'INVALID_CONTENT', '단계 이름과 슬라이드 제목의 길이를 확인해주세요.')
      }
      if (!prompt || prompt.length > 800 || helper.length > 500) {
        return error(state, 'INVALID_CONTENT', '질문은 800자, 도움말은 500자 이하로 입력해주세요.')
      }
      if (!Number.isInteger(input.durationSec) || input.durationSec < 60 || input.durationSec > 10_800) {
        return error(state, 'INVALID_CONTENT', '타이머는 1분에서 180분 사이로 설정해주세요.')
      }
      const illustration = input.illustration.startsWith('/assets/illustrations/')
        ? input.illustration
        : '/assets/illustrations/cat-ideation.webp'
      const created = {
        id: env.createId('slide'),
        order: state.slides.length + 1,
        eyebrow,
        title,
        prompt,
        helper,
        durationSec: input.durationSec,
        illustration,
      }
      return success(
        state,
        {
          ...state,
          slides: [...state.slides, created],
          live: {
            ...state.live,
            answersRevealedBySlide: {
              ...state.live.answersRevealedBySlide,
              [created.id]: false,
            },
            commentsEnabledBySlide: {
              ...state.live.commentsEnabledBySlide,
              [created.id]: false,
            },
          },
        },
        created,
        '새 슬라이드를 덱 마지막에 추가했어요.',
      )
    }

    case 'DELETE_SLIDE': {
      const deletingIndex = state.slides.findIndex((slide) => slide.id === command.slideId)
      if (deletingIndex < 0) return error(state, 'NOT_FOUND', '삭제할 슬라이드를 찾을 수 없어요.')
      if (state.slides.length <= 1) return error(state, 'NOT_ALLOWED', '행사에는 슬라이드가 하나 이상 필요해요.')
      if (deletingIndex === state.live.activeSlideIndex && state.live.timer.status === 'running') {
        return error(state, 'NOT_ALLOWED', '진행 중인 슬라이드는 타이머를 일시정지한 뒤 삭제해주세요.')
      }
      if (state.answers.some((answer) => answer.slideId === command.slideId)) {
        return error(state, 'NOT_ALLOWED', '참여자 답변이 있는 슬라이드는 삭제할 수 없어요.')
      }
      const previousActiveId = state.slides[state.live.activeSlideIndex]?.id
      const slides = state.slides
        .filter((slide) => slide.id !== command.slideId)
        .map((slide, index) => ({ ...slide, order: index + 1 }))
      const activeSlideIndex = previousActiveId === command.slideId
        ? Math.min(deletingIndex, slides.length - 1)
        : Math.max(0, slides.findIndex((slide) => slide.id === previousActiveId))
      const activeSlide = slides[activeSlideIndex]
      const answersRevealedBySlide = { ...state.live.answersRevealedBySlide }
      const commentsEnabledBySlide = { ...state.live.commentsEnabledBySlide }
      delete answersRevealedBySlide[command.slideId]
      delete commentsEnabledBySlide[command.slideId]
      return success(
        state,
        {
          ...state,
          slides,
          live: {
            ...state.live,
            activeSlideIndex,
            answersRevealedBySlide,
            commentsEnabledBySlide,
            timer: previousActiveId === command.slideId
              ? {
                  durationSec: activeSlide.durationSec,
                  remainingSec: activeSlide.durationSec,
                  status: 'idle',
                  endsAt: null,
                }
              : state.live.timer,
          },
        },
        command.slideId,
        '슬라이드를 삭제하고 순서를 다시 정리했어요.',
      )
    }

    case 'MOVE_SLIDE': {
      const sourceIndex = state.slides.findIndex((slide) => slide.id === command.slideId)
      if (sourceIndex < 0) return error(state, 'NOT_FOUND', '이동할 슬라이드를 찾을 수 없어요.')
      const targetIndex = sourceIndex + (command.direction === 'up' ? -1 : 1)
      if (!state.slides[targetIndex]) return error(state, 'NOT_ALLOWED', '슬라이드를 더 이동할 수 없어요.')
      const activeSlideId = state.slides[state.live.activeSlideIndex]?.id
      const reordered = [...state.slides]
      ;[reordered[sourceIndex], reordered[targetIndex]] = [reordered[targetIndex], reordered[sourceIndex]]
      const slides = reordered.map((slide, index) => ({ ...slide, order: index + 1 }))
      return success(
        state,
        {
          ...state,
          slides,
          live: {
            ...state.live,
            activeSlideIndex: Math.max(0, slides.findIndex((slide) => slide.id === activeSlideId)),
          },
        },
        command.slideId,
        '슬라이드 순서를 변경했어요.',
      )
    }

    case 'REORDER_SLIDES': {
      const currentIds = state.slides.map((slide) => slide.id)
      if (
        command.orderedSlideIds.length !== currentIds.length
        || new Set(command.orderedSlideIds).size !== currentIds.length
        || currentIds.some((slideId) => !command.orderedSlideIds.includes(slideId))
      ) {
        return error(state, 'INVALID_CONTENT', '현재 슬라이드와 정렬하려는 목록이 일치하지 않아요.')
      }
      const activeSlideId = state.slides[state.live.activeSlideIndex]?.id
      const byId = new Map(state.slides.map((slide) => [slide.id, slide]))
      const slides = command.orderedSlideIds.map((slideId, index) => ({
        ...byId.get(slideId)!,
        order: index + 1,
      }))
      return success(state, {
        ...state,
        slides,
        live: {
          ...state.live,
          activeSlideIndex: Math.max(0, slides.findIndex((slide) => slide.id === activeSlideId)),
        },
      }, slides, '슬라이드 순서를 저장했어요.')
    }

    case 'END_SESSION': {
      return success(state, {
        ...state,
        room: { ...state.room, lifecycle: 'ended' },
        participants: state.participants.map((participant) => ({ ...participant, status: 'offline' })),
        live: {
          ...state.live,
          timer: { ...state.live.timer, status: 'complete', remainingSec: 0, endsAt: null },
        },
      }, undefined, '세션을 종료하고 참여자 연결을 닫았어요.')
    }

    case 'SET_ACTIVE_SLIDE': {
      if (!Number.isInteger(command.slideIndex) || !state.slides[command.slideIndex]) {
        return error(state, 'NOT_FOUND', '해당 슬라이드를 찾을 수 없어요.')
      }
      const slide = state.slides[command.slideIndex]
      return success(
        state,
        {
          ...state,
          live: {
            ...state.live,
            activeSlideIndex: command.slideIndex,
            startedAt: state.live.startedAt ?? nowIso,
            timer: {
              durationSec: slide.durationSec,
              remainingSec: slide.durationSec,
              status: 'idle',
              endsAt: null,
            },
          },
        },
        slide,
        `${slide.order}단계로 화면을 맞췄어요.`,
      )
    }

    case 'SET_TIMER_DURATION': {
      if (
        !Number.isInteger(command.durationSec)
        || command.durationSec < 60
        || command.durationSec > 10_800
      ) {
        return error(state, 'INVALID_CONTENT', '타이머는 1분에서 180분 사이로 설정해주세요.')
      }
      if (state.live.timer.status === 'running') {
        return error(state, 'NOT_ALLOWED', '진행 중인 타이머를 일시정지한 뒤 시간을 변경해주세요.')
      }
      const activeSlide = state.slides[state.live.activeSlideIndex]
      if (!activeSlide) return error(state, 'NOT_FOUND', '현재 슬라이드를 찾을 수 없어요.')
      const timer = {
        durationSec: command.durationSec,
        remainingSec: command.durationSec,
        status: 'idle' as const,
        endsAt: null,
      }
      return success(
        state,
        {
          ...state,
          slides: state.slides.map((slide) => slide.id === activeSlide.id
            ? {
                ...slide,
                durationSec: command.durationSec,
                eyebrow: withTimerMinutes(slide.eyebrow, command.durationSec),
              }
            : slide),
          live: { ...state.live, timer },
        },
        timer,
        `현재 단계 타이머를 ${Math.round(command.durationSec / 60)}분으로 설정했어요.`,
      )
    }

    case 'START_SESSION': {
      const firstSlide = state.slides[0]
      if (!firstSlide) return error(state, 'NOT_FOUND', '시작할 슬라이드를 찾을 수 없어요.')
      if (state.room.lifecycle === 'live') {
        return success(state, state, state.live.timer, '이미 시작된 세션이에요.')
      }
      if (state.room.lifecycle === 'ended') {
        return error(state, 'NOT_ALLOWED', '종료된 세션은 다시 시작할 수 없어요.')
      }
      const timer = {
        durationSec: firstSlide.durationSec,
        remainingSec: firstSlide.durationSec,
        status: 'running' as const,
        endsAt: now + firstSlide.durationSec * 1_000,
      }
      return success(state, {
        ...state,
        room: { ...state.room, lifecycle: 'live' },
        live: {
          ...state.live,
          activeSlideIndex: 0,
          startedAt: nowIso,
          timer,
        },
      }, timer, '세션을 시작하고 참여자 화면에 첫 슬라이드를 열었어요.')
    }

    case 'START_TIMER':
    case 'RESUME_TIMER': {
      const timerView = getTimerView(state.live.timer, now)
      const remainingSec = timerView.remainingSec === 0 ? state.live.timer.durationSec : timerView.remainingSec
      const timer = {
        ...state.live.timer,
        remainingSec,
        status: 'running' as const,
        endsAt: now + remainingSec * 1_000,
      }
      return success(state, { ...state, live: { ...state.live, timer } }, timer, '타이머를 시작했어요.')
    }

    case 'PAUSE_TIMER': {
      const timerView = getTimerView(state.live.timer, now)
      const timer = {
        ...state.live.timer,
        remainingSec: timerView.remainingSec,
        status: timerView.remainingSec === 0 ? ('complete' as const) : ('paused' as const),
        endsAt: null,
      }
      return success(state, { ...state, live: { ...state.live, timer } }, timer, '타이머를 잠시 멈췄어요.')
    }

    case 'RESET_TIMER': {
      const slide = state.slides[state.live.activeSlideIndex]
      const timer = {
        durationSec: slide.durationSec,
        remainingSec: slide.durationSec,
        status: 'idle' as const,
        endsAt: null,
      }
      return success(state, { ...state, live: { ...state.live, timer } }, timer, '타이머를 초기화했어요.')
    }

    case 'SET_ANSWERS_REVEALED': {
      if (!state.slides.some(({ id }) => id === command.slideId)) {
        return error(state, 'NOT_FOUND', '해당 질문을 찾을 수 없어요.')
      }
      const live = {
        ...state.live,
        answersRevealedBySlide: {
          ...state.live.answersRevealedBySlide,
          [command.slideId]: command.revealed,
        },
        commentsEnabledBySlide: {
          ...state.live.commentsEnabledBySlide,
          ...(command.revealed ? {} : { [command.slideId]: false }),
        },
      }
      return success(
        state,
        { ...state, live },
        command.revealed,
        command.revealed ? '참가자 답변을 공개했어요.' : '답변을 다시 비공개로 전환했어요.',
      )
    }

    case 'SET_COMMENTS_ENABLED': {
      if (!state.slides.some(({ id }) => id === command.slideId)) {
        return error(state, 'NOT_FOUND', '해당 질문을 찾을 수 없어요.')
      }
      if (command.enabled && !state.live.answersRevealedBySlide[command.slideId]) {
        return error(state, 'NOT_ALLOWED', '답변을 먼저 공개해야 댓글을 열 수 있어요.')
      }
      return success(
        state,
        {
          ...state,
          live: {
            ...state.live,
            commentsEnabledBySlide: {
              ...state.live.commentsEnabledBySlide,
              [command.slideId]: command.enabled,
            },
          },
        },
        command.enabled,
        command.enabled ? '댓글 작성을 열었어요.' : '댓글 작성을 잠갔어요.',
      )
    }

    case 'UPDATE_SLIDE': {
      const { input } = command
      const slide = state.slides.find((candidate) => candidate.id === input.slideId)
      if (!slide) return error(state, 'NOT_FOUND', '편집할 슬라이드를 찾을 수 없어요.')
      const eyebrow = input.eyebrow.trim()
      const title = input.title.trim()
      const prompt = input.prompt.trim()
      const helper = input.helper.trim()
      if (!eyebrow || eyebrow.length > 80) {
        return error(state, 'INVALID_CONTENT', '단계 이름은 1자 이상 80자 이하로 입력해주세요.')
      }
      if (!title || title.length > 160) {
        return error(state, 'INVALID_CONTENT', '슬라이드 제목은 1자 이상 160자 이하로 입력해주세요.')
      }
      if (!prompt || prompt.length > 800 || helper.length > 500) {
        return error(state, 'INVALID_CONTENT', '질문은 800자, 도움말은 500자 이하로 입력해주세요.')
      }
      const updated = { ...slide, eyebrow, title, prompt, helper }
      return success(
        state,
        {
          ...state,
          slides: state.slides.map((candidate) => candidate.id === slide.id ? updated : candidate),
        },
        updated,
        '슬라이드 내용을 모든 화면에 반영했어요.',
      )
    }

    case 'SAVE_ANSWER': {
      const { input } = command
      if (state.room.lifecycle === 'lobby') {
        return error(state, 'NOT_ALLOWED', '주최자가 세션을 시작한 뒤 답변할 수 있어요.')
      }
      if (!state.participants.some(({ id }) => id === input.participantId)) {
        return error(state, 'NOT_FOUND', '참가자 정보를 찾을 수 없어요.')
      }
      if (!state.slides.some(({ id }) => id === input.slideId)) {
        return error(state, 'NOT_FOUND', '질문을 찾을 수 없어요.')
      }
      const activeSlide = state.slides[state.live.activeSlideIndex]
      if (activeSlide?.id !== input.slideId) {
        return error(state, 'NOT_ALLOWED', '현재 진행 중인 질문에만 답변할 수 있어요.')
      }
      if (getTimerView(state.live.timer, now).status === 'complete') {
        return error(state, 'NOT_ALLOWED', '답변 시간이 종료되어 더 이상 저장할 수 없어요.')
      }
      const content = input.content.trim()
      if (!content || content.length > 1_200) {
        return error(state, 'INVALID_CONTENT', '답변은 1자 이상 1,200자 이하로 입력해주세요.')
      }
      if (state.live.answersRevealedBySlide[input.slideId]) {
        return error(state, 'NOT_ALLOWED', '이미 공개된 단계의 답변은 수정할 수 없어요.')
      }
      const existing = state.answers.find(
        (answer) => answer.participantId === input.participantId && answer.slideId === input.slideId,
      )
      const saved: Answer = existing
        ? {
            ...existing,
            content,
            draftRevision: (existing.draftRevision ?? 0) + 1,
            status: input.submit === false ? existing.status : 'submitted',
            updatedAt: nowIso,
            submittedAt: input.submit === false ? existing.submittedAt : nowIso,
          }
        : {
            id: env.createId('answer'),
            participantId: input.participantId,
            slideId: input.slideId,
            content,
            draftRevision: 1,
            status: input.submit === false ? 'draft' : 'submitted',
            createdAt: nowIso,
            updatedAt: nowIso,
            submittedAt: input.submit === false ? null : nowIso,
          }
      const answers = existing
        ? state.answers.map((answer) => (answer.id === existing.id ? saved : answer))
        : [...state.answers, saved]
      return success(
        state,
        { ...state, answers },
        saved,
        saved.status === 'submitted' ? '개인 답변을 제출했어요.' : '답변을 임시 저장했어요.',
      )
    }

    case 'ADD_COMMENT': {
      const gate = validateCommentGate(state, command.input)
      if (!gate.ok) return { state, result: gate }
      if (!state.participants.some(({ id }) => id === command.input.participantId)) {
        return error(state, 'NOT_FOUND', '참가자 정보를 찾을 수 없어요.')
      }
      const body = command.input.body.trim()
      if (!body || body.length > 500) {
        return error(state, 'INVALID_CONTENT', '댓글은 1자 이상 500자 이하로 입력해주세요.')
      }
      const comment: Comment = {
        id: env.createId('comment'),
        participantId: command.input.participantId,
        answerId: command.input.answerId,
        body,
        createdAt: nowIso,
        updatedAt: nowIso,
      }
      return success(
        state,
        { ...state, comments: [...state.comments, comment] },
        comment,
        '댓글을 남겼어요.',
      )
    }

    case 'SET_LIVE_REACTION': {
      if (state.room.lifecycle !== 'live') {
        return error(state, 'NOT_ALLOWED', '세션 진행 중에만 반응을 보낼 수 있어요.')
      }
      const participant = state.participants.find(({ id }) => id === command.input.participantId)
      if (!participant) return error(state, 'NOT_FOUND', '참가자 정보를 찾을 수 없어요.')
      const activeSlide = state.slides[state.live.activeSlideIndex]
      if (!activeSlide || activeSlide.id !== command.input.slideId) {
        return error(state, 'NOT_ALLOWED', '현재 진행 중인 슬라이드에만 반응할 수 있어요.')
      }
      const existing = state.liveReactions.find(
        (reaction) => reaction.participantId === participant.id && reaction.slideId === activeSlide.id,
      )
      if (command.input.kind === null) {
        return success(
          state,
          {
            ...state,
            liveReactions: state.liveReactions.filter((reaction) => reaction.id !== existing?.id),
          },
          null,
          '반응을 취소했어요.',
        )
      }
      const reaction: LiveReaction = existing
        ? { ...existing, kind: command.input.kind, updatedAt: nowIso }
        : {
            id: env.createId('live-reaction'),
            participantId: participant.id,
            slideId: activeSlide.id,
            kind: command.input.kind,
            updatedAt: nowIso,
          }
      return success(
        state,
        {
          ...state,
          liveReactions: existing
            ? state.liveReactions.map((item) => item.id === existing.id ? reaction : item)
            : [...state.liveReactions, reaction],
        },
        reaction,
        '반응을 보냈어요.',
      )
    }

    case 'SEND_LIVE_CHAT_MESSAGE': {
      if (state.room.lifecycle !== 'live') {
        return error(state, 'NOT_ALLOWED', '세션 진행 중에만 채팅을 보낼 수 있어요.')
      }
      if (!state.participants.some(({ id }) => id === command.input.participantId)) {
        return error(state, 'NOT_FOUND', '참가자 정보를 찾을 수 없어요.')
      }
      const activeSlide = state.slides[state.live.activeSlideIndex]
      if (!activeSlide || activeSlide.id !== command.input.slideId) {
        return error(state, 'NOT_ALLOWED', '현재 진행 중인 슬라이드에만 채팅할 수 있어요.')
      }
      const body = command.input.body.trim()
      if (!body || body.length > 280) {
        return error(state, 'INVALID_CONTENT', '라이브 채팅은 1자 이상 280자 이하로 입력해주세요.')
      }
      const message: LiveChatMessage = {
        id: env.createId('live-chat'),
        participantId: command.input.participantId,
        slideId: activeSlide.id,
        body,
        createdAt: nowIso,
      }
      return success(
        state,
        { ...state, liveChatMessages: [...state.liveChatMessages, message] },
        message,
        '주최자와 참여자에게 채팅을 보냈어요.',
      )
    }

    case 'DELETE_LIVE_CHAT_MESSAGE': {
      const message = state.liveChatMessages.find(({ id }) => id === command.input.messageId)
      if (!message) return error(state, 'NOT_FOUND', '채팅 메시지를 찾을 수 없어요.')
      if (command.input.participantId && message.participantId !== command.input.participantId) {
        return error(state, 'NOT_ALLOWED', '자신이 보낸 채팅만 삭제할 수 있어요.')
      }
      return success(
        state,
        {
          ...state,
          liveChatMessages: state.liveChatMessages.filter(({ id }) => id !== message.id),
        },
        undefined,
        '채팅 메시지를 삭제했어요.',
      )
    }

    case 'UPDATE_COMMENT': {
      const existing = state.comments.find(({ id }) => id === command.input.commentId)
      if (!existing) return error(state, 'NOT_FOUND', '댓글을 찾을 수 없어요.')
      if (existing.participantId !== command.input.participantId) {
        return error(state, 'NOT_ALLOWED', '자신이 작성한 댓글만 수정할 수 있어요.')
      }
      const gate = validateCommentGate(state, { answerId: existing.answerId })
      if (!gate.ok) return { state, result: gate }
      const body = command.input.body.trim()
      if (!body || body.length > 500) {
        return error(state, 'INVALID_CONTENT', '댓글은 1자 이상 500자 이하로 입력해주세요.')
      }
      const updated = { ...existing, body, updatedAt: nowIso }
      return success(
        state,
        {
          ...state,
          comments: state.comments.map((comment) =>
            comment.id === existing.id ? updated : comment,
          ),
        },
        updated,
        '댓글을 수정했어요.',
      )
    }

    case 'DELETE_COMMENT': {
      const existing = state.comments.find(({ id }) => id === command.input.commentId)
      if (!existing) return error(state, 'NOT_FOUND', '댓글을 찾을 수 없어요.')
      if (existing.participantId !== command.input.participantId) {
        return error(state, 'NOT_ALLOWED', '자신이 작성한 댓글만 삭제할 수 있어요.')
      }
      return success(
        state,
        { ...state, comments: state.comments.filter(({ id }) => id !== existing.id) },
        undefined,
        '댓글을 삭제했어요.',
      )
    }

    case 'ADD_REVIEW_THREAD': {
      const { input } = command
      const target = input.targetType === 'answer'
        ? state.answers.find((answer) => answer.id === input.targetId)
        : state.submissions.find((submission) => submission.id === input.targetId)
      if (!target) return error(state, 'NOT_FOUND', '검토할 참여자 자료를 찾을 수 없어요.')
      const body = input.body.trim()
      if (!body || body.length > 1_000) {
        return error(state, 'INVALID_CONTENT', '검토 댓글은 1자 이상 1,000자 이하로 입력해주세요.')
      }
      const message: ReviewMessage = {
        id: env.createId('review-message'),
        authorRole: 'organizer',
        participantId: null,
        body,
        createdAt: nowIso,
        updatedAt: nowIso,
      }
      const thread: ReviewThread = {
        id: env.createId('review-thread'),
        targetType: input.targetType,
        targetId: input.targetId,
        field: input.field.trim().slice(0, 80) || '전체',
        quote: input.quote?.trim().slice(0, 280) ?? '',
        status: 'open',
        messages: [message],
        createdAt: nowIso,
        updatedAt: nowIso,
        resolvedAt: null,
      }
      return success(
        state,
        { ...state, reviewThreads: [...state.reviewThreads, thread] },
        thread,
        '참여자에게 비공개 검토 댓글을 남겼어요.',
      )
    }

    case 'ADD_REVIEW_REPLY': {
      const { input } = command
      const thread = state.reviewThreads.find((candidate) => candidate.id === input.threadId)
      if (!thread) return error(state, 'NOT_FOUND', '검토 댓글을 찾을 수 없어요.')
      if (!canAccessReviewThread(state, thread, input.authorRole, input.participantId)) {
        return error(state, 'NOT_ALLOWED', '이 검토 댓글에 답글을 남길 권한이 없어요.')
      }
      const body = input.body.trim()
      if (!body || body.length > 1_000) {
        return error(state, 'INVALID_CONTENT', '답글은 1자 이상 1,000자 이하로 입력해주세요.')
      }
      const message: ReviewMessage = {
        id: env.createId('review-message'),
        authorRole: input.authorRole,
        participantId: input.authorRole === 'participant' ? (input.participantId ?? null) : null,
        body,
        createdAt: nowIso,
        updatedAt: nowIso,
      }
      const updated = {
        ...thread,
        messages: [...thread.messages, message],
        updatedAt: nowIso,
      }
      return success(
        state,
        {
          ...state,
          reviewThreads: state.reviewThreads.map((candidate) =>
            candidate.id === updated.id ? updated : candidate,
          ),
        },
        updated,
        '검토 댓글에 답글을 남겼어요.',
      )
    }

    case 'SET_REVIEW_THREAD_STATUS': {
      const { input } = command
      const thread = state.reviewThreads.find((candidate) => candidate.id === input.threadId)
      if (!thread) return error(state, 'NOT_FOUND', '검토 댓글을 찾을 수 없어요.')
      if (!canAccessReviewThread(state, thread, input.authorRole, input.participantId)) {
        return error(state, 'NOT_ALLOWED', '이 검토 댓글의 상태를 바꿀 권한이 없어요.')
      }
      const updated = {
        ...thread,
        status: input.status,
        updatedAt: nowIso,
        resolvedAt: input.status === 'resolved' ? nowIso : null,
      }
      return success(
        state,
        {
          ...state,
          reviewThreads: state.reviewThreads.map((candidate) =>
            candidate.id === updated.id ? updated : candidate,
          ),
        },
        updated,
        input.status === 'resolved' ? '검토 의견을 해결됨으로 표시했어요.' : '검토 의견을 다시 열었어요.',
      )
    }

    case 'SUBMIT_PROJECT': {
      const { input } = command
      if (!state.participants.some(({ id }) => id === input.participantId)) {
        return error(state, 'NOT_FOUND', '참가자 정보를 찾을 수 없어요.')
      }
      const validation = validateSubmission(input)
      if (!validation.ok) return { state, result: validation }
      const existing = state.submissions.find(
        (submission) => submission.participantId === input.participantId,
      )
      const status = input.submit === false
        ? (existing?.status ?? ('draft' as const))
        : ('submitted' as const)
      const saved: Submission = {
        id: existing?.id ?? env.createId('submission'),
        participantId: input.participantId,
        title: input.title.trim(),
        pitch: input.pitch.trim(),
        description: input.description.trim(),
        draftRevision: (existing?.draftRevision ?? 0) + 1,
        demoUrl: input.demoUrl?.trim() ?? '',
        githubUrl: input.githubUrl?.trim() ?? '',
        tags: (input.tags ?? []).map((tag) => tag.trim()).filter(Boolean).slice(0, 6),
        retrospective: input.retrospective.trim(),
        coverImage: input.coverImage?.trim() || '/assets/illustrations/cat-submission.webp',
        status,
        createdAt: existing?.createdAt ?? nowIso,
        updatedAt: nowIso,
        submittedAt: status === 'submitted' ? nowIso : (existing?.submittedAt ?? null),
      }
      const submissions = existing
        ? state.submissions.map((submission) => (submission.id === existing.id ? saved : submission))
        : [...state.submissions, saved]
      return success(
        state,
        { ...state, submissions },
        saved,
        status === 'submitted' ? '개인 작품을 제출했어요.' : '작품을 임시 저장했어요.',
      )
    }

    case 'INVITE_ADMIN': {
      const email = command.email.trim().toLocaleLowerCase()
      if (!isEmail(email)) return error(state, 'INVALID_EMAIL', '올바른 이메일 주소를 입력해주세요.')
      if (state.adminInvites.some((invite) => invite.email.toLocaleLowerCase() === email)) {
        return error(state, 'DUPLICATE_INVITE', '이미 초대한 이메일이에요.')
      }
      const invite = { id: env.createId('admin-invite'), email, status: 'pending' as const, invitedAt: nowIso }
      return success(
        state,
        { ...state, adminInvites: [...state.adminInvites, invite] },
        invite,
        '관리자 초대 요청을 기록했어요. 실제 메일은 아직 발송되지 않습니다.',
      )
    }

    case 'ACCEPT_ADMIN_INVITE': {
      const invite = state.adminInvites.find(({ id }) => id === command.inviteId)
      if (!invite) return error(state, 'NOT_FOUND', '관리자 초대를 찾을 수 없어요.')
      const accepted = { ...invite, status: 'accepted' as const }
      return success(
        state,
        {
          ...state,
          adminInvites: state.adminInvites.map((candidate) =>
            candidate.id === accepted.id ? accepted : candidate,
          ),
        },
        accepted,
        '관리자 권한을 수락했어요.',
      )
    }

    case 'REVOKE_ADMIN': {
      const invite = state.adminInvites.find(({ id }) => id === command.inviteId)
      if (!invite || (invite.status !== 'accepted' && invite.status !== 'pending')) {
        return error(state, 'NOT_FOUND', '취소할 관리자 초대 또는 권한을 찾을 수 없어요.')
      }
      const revoked = { ...invite, status: 'revoked' as const }
      return success(
        state,
        {
          ...state,
          adminInvites: state.adminInvites.map((candidate) =>
            candidate.id === revoked.id ? revoked : candidate,
          ),
        },
        revoked,
        invite.status === 'pending' ? '관리자 초대를 취소했어요.' : '관리자 권한을 해제했어요.',
      )
    }

    case 'UPDATE_SYNTHESIS': {
      const input = command.input
      const themeIds = input.themeIds?.filter((id) => state.themes.some((theme) => theme.id === id))
      const highlightAnswerIds = input.highlightAnswerIds?.filter((id) =>
        state.answers.some((answer) => answer.id === id && answer.status === 'submitted'),
      )
      const synthesis = {
        ...state.synthesis,
        ...(input.organizerSummary === undefined
          ? {}
          : { organizerSummary: input.organizerSummary.trim().slice(0, 4_000) }),
        ...(input.nicknamePolicy === undefined ? {} : { nicknamePolicy: input.nicknamePolicy }),
        ...(themeIds === undefined ? {} : { themeIds }),
        ...(highlightAnswerIds === undefined ? {} : { highlightAnswerIds }),
        revision: state.synthesis.revision + 1,
        updatedAt: nowIso,
      }
      return success(state, { ...state, synthesis }, synthesis, '정리 세션 내용을 저장했어요.')
    }

    case 'PUBLISH_SYNTHESIS': {
      const publishedSnapshot = createPublishedSnapshot(state, nowIso)
      return success(
        state,
        { ...state, publishedSnapshot },
        publishedSnapshot,
        `공개 리비전 ${publishedSnapshot.revision}을 발행했어요.`,
      )
    }

    case 'SET_EXHIBITION_PUBLISHED': {
      const withExhibition = { ...state, exhibitionPublished: command.published }
      const publishedSnapshot = state.publishedSnapshot
        ? createPublishedSnapshot(withExhibition, nowIso)
        : null
      return success(
        state,
        { ...withExhibition, publishedSnapshot },
        command.published,
        command.published ? '개인 작품 전시를 공개했어요.' : '개인 작품 전시를 비공개로 전환했어요.',
      )
    }

    case 'RESET_DEMO': {
      const seed = createEmptyState()
      return {
        state: { ...seed, revision: state.revision + 1 },
        result: { ok: true, value: undefined, notice: '빈 행사 상태로 초기화했어요.' },
      }
    }
  }
}
