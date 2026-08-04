import type {
  AddCommentInput,
  Answer,
  CommandErrorCode,
  CommandOutcome,
  CommandResult,
  Comment,
  PlatformCommand,
  PrototypeState,
  Submission,
  SubmitProjectInput,
  TimerView,
} from './models'
import { createPublishedSnapshot } from './publicProjection'
import { createSeedState, normalizeNickname } from './seed'

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
        return error(state, 'INVALID_PIN', 'PIN은 숫자 4자리여야 해요.')
      }
      const existing = state.participants.find(
        (participant) => participant.normalizedNickname === normalizedNickname,
      )
      if (existing) {
        if (existing.pin !== command.input.pin) {
          return error(state, 'PIN_MISMATCH', '닉네임은 맞지만 PIN이 일치하지 않아요. 관리자에게 문의해주세요.')
        }
        const reentered = { ...existing, status: 'online' as const, lastSeenAt: nowIso }
        return success(
          state,
          {
            ...state,
            participants: state.participants.map((participant) =>
              participant.id === existing.id ? reentered : participant,
            ),
          },
          reentered,
          '이전 기록을 이어서 입장했어요.',
        )
      }
      if (state.participants.length >= state.room.capacity) {
        return error(state, 'ROOM_FULL', `이 방은 최대 ${state.room.capacity}명까지 참여할 수 있어요.`)
      }
      const created = {
        id: env.createId('participant'),
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
        '입장이 완료됐어요. 이 브라우저에 참여 정보를 기억할게요.',
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

    case 'SAVE_ANSWER': {
      const { input } = command
      if (!state.participants.some(({ id }) => id === input.participantId)) {
        return error(state, 'NOT_FOUND', '참가자 정보를 찾을 수 없어요.')
      }
      if (!state.slides.some(({ id }) => id === input.slideId)) {
        return error(state, 'NOT_FOUND', '질문을 찾을 수 없어요.')
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
            status: input.submit === false ? 'draft' : 'submitted',
            updatedAt: nowIso,
            submittedAt: input.submit === false ? existing.submittedAt : nowIso,
          }
        : {
            id: env.createId('answer'),
            participantId: input.participantId,
            slideId: input.slideId,
            content,
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
      const status = input.submit === false ? ('draft' as const) : ('submitted' as const)
      const saved: Submission = {
        id: existing?.id ?? env.createId('submission'),
        participantId: input.participantId,
        title: input.title.trim(),
        pitch: input.pitch.trim(),
        description: input.description.trim(),
        demoUrl: input.demoUrl?.trim() ?? '',
        githubUrl: input.githubUrl?.trim() ?? '',
        tags: (input.tags ?? []).map((tag) => tag.trim()).filter(Boolean).slice(0, 6),
        retrospective: input.retrospective.trim(),
        coverImage: input.coverImage?.trim() || '/assets/illustrations/cat-submission.png',
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
        '프로토타입 초대를 보냈어요.',
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
      const seed = createSeedState()
      return {
        state: { ...seed, revision: state.revision + 1 },
        result: { ok: true, value: undefined, notice: '큐레이션된 데모 상태로 되돌렸어요.' },
      }
    }
  }
}
