import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { executePlatformCommand, getTimerView } from '../domain/commands'
import type {
  CommandResult,
  JoinParticipantInput,
  Participant,
  PlatformCommand,
  PrototypeState,
  Slide,
  TimerView,
} from '../domain/models'
import { createEmptyState } from '../domain/eventTemplate'
import {
  bootstrapVibe26Event,
  createFirebaseEventBackend,
  joinParticipantWithPin,
  observeFirebaseAuthSession,
  observeFirebaseEventMembership,
  resolveFirebaseEventMembership,
  sendAdminInviteEmailLink,
  signInOrganizerWithGoogle,
  signOutFirebase,
  type FirebaseAuthoritativeCommand,
  type FirebaseAuthSession,
  type FirebaseBackend,
  type FirebaseDraftStatus,
  type FirebaseEventMembership,
} from '../platform/firebase'
import {
  createBrowserPersistence,
  getSelectedParticipantId,
  setSelectedParticipantId,
  type PlatformPersistence,
} from '../platform/persistence'
import type { AutosavePhase } from '../platform/useAutosave'
import { useLocation } from './router'

const LEGACY_EVENT_ID = 'room-vibe26'
const LEGACY_PUBLIC_SLUG = 'vibecoding-2026'

function routeSegment(pathname: string, pattern: RegExp): string | null {
  const value = pathname.match(pattern)?.[1]
  if (!value) return null
  try { return decodeURIComponent(value) } catch { return null }
}

function eventIdFromPath(pathname: string): string | null {
  return routeSegment(pathname, /^\/(?:admin\/)?events\/([^/]+)/)
}

export function publicSlugFromPath(pathname: string, eventId: string | null): string {
  const publicSlug = routeSegment(pathname, /^\/(?:dashboards|exhibitions)\/([^/]+)/)
    ?? routeSegment(pathname, /^\/embed\/(?:dashboards\/)?([^/]+)/)
    ?? routeSegment(pathname, /^\/join\/([^/]+)/)
  if (publicSlug) {
    const normalized = publicSlug.toLowerCase()
    return normalized === 'vibe26' ? LEGACY_PUBLIC_SLUG : normalized
  }
  if (!eventId || eventId === LEGACY_EVENT_ID) return LEGACY_PUBLIC_SLUG
  return eventId.startsWith('session-') ? eventId.slice('session-'.length) : eventId
}

export type PlatformBackendPhase = 'loading' | 'ready' | 'error'
export type PlatformAuthRole = 'owner' | 'admin' | 'participant' | null

export interface PlatformContextValue {
  state: PrototypeState
  selectedParticipantId: string | null
  currentParticipant: Participant | null
  currentSlide: Slide
  timerView: TimerView
  backendPhase: PlatformBackendPhase
  backendError: string | null
  authRole: PlatformAuthRole
  authEmail: string | null
  dispatch: <T = unknown>(command: PlatformCommand) => CommandResult<T>
  dispatchAsync: <T = unknown>(command: PlatformCommand) => Promise<CommandResult<T>>
  joinParticipant: (input: JoinParticipantInput) => Promise<CommandResult<Participant>>
  revealParticipantPin: (participantId: string, reason: string) => Promise<CommandResult<string>>
  savePrivateDraft: (
    targetType: 'comment' | 'comment-edit' | 'review-composer' | 'review-reply',
    targetId: string,
    payload: Record<string, unknown>,
  ) => Promise<boolean>
  selectParticipant: (participantId: string | null) => void
  signInOrganizer: () => Promise<CommandResult<undefined>>
  signOut: () => Promise<void>
}

const PlatformContext = createContext<PlatformContextValue | null>(null)

function commandError(message: string): CommandResult<never> {
  return { ok: false, error: { code: 'NOT_ALLOWED', message } }
}

function draftPhase(status: FirebaseDraftStatus): AutosavePhase {
  if (status.phase === 'confirmed') return 'saved'
  if (status.phase === 'rejected') return 'error'
  if (status.phase === 'pending') return navigator.onLine ? 'pending' : 'offline'
  return 'saving'
}

function makePersistence(): PlatformPersistence | null {
  return typeof window === 'undefined' ? null : createBrowserPersistence()
}

function LocalPlatformProvider({ children }: { children: ReactNode }) {
  const persistenceRef = useRef<PlatformPersistence | null>(null)
  if (persistenceRef.current === null && typeof window !== 'undefined') {
    persistenceRef.current = makePersistence()
  }

  const [state, setState] = useState<PrototypeState>(() =>
    persistenceRef.current?.load() ?? createEmptyState(),
  )
  const stateRef = useRef(state)
  const [selectedParticipantId, setSelectedParticipant] = useState<string | null>(() =>
    getSelectedParticipantId(),
  )
  const [clock, setClock] = useState(() => Date.now())

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    const persistence = persistenceRef.current
    if (!persistence) return
    if (!persistence.load()) persistence.save(stateRef.current)
    return persistence.subscribe((incoming) => {
      if (incoming.revision > stateRef.current.revision) {
        stateRef.current = incoming
        setState(incoming)
      }
    })
  }, [])

  useEffect(() => {
    if (state.live.timer.status !== 'running') return
    const interval = window.setInterval(() => setClock(Date.now()), 1_000)
    return () => window.clearInterval(interval)
  }, [state.live.timer.status, state.live.timer.endsAt])

  const selectParticipant = useCallback((participantId: string | null) => {
    setSelectedParticipantId(participantId)
    setSelectedParticipant(participantId)
  }, [])

  const dispatch = useCallback(<T,>(command: PlatformCommand): CommandResult<T> => {
    const outcome = executePlatformCommand(stateRef.current, command)
    if (!outcome.result.ok) return outcome.result as CommandResult<T>

    stateRef.current = outcome.state
    setState(outcome.state)
    setClock(Date.now())
    if (command.type === 'RESET_DEMO') {
      selectParticipant(null)
    } else if (command.type === 'JOIN_PARTICIPANT') {
      const participant = outcome.result.value as Participant
      selectParticipant(participant.id)
    }
    persistenceRef.current?.save(outcome.state)
    return outcome.result as CommandResult<T>
  }, [selectParticipant])

  const joinParticipant = useCallback(async (input: JoinParticipantInput) => (
    dispatch<Participant>({ type: 'JOIN_PARTICIPANT', input })
  ), [dispatch])

  const value = useMemo<PlatformContextValue>(() => {
    const currentSlide = state.slides[state.live.activeSlideIndex] ?? state.slides[0]
    return {
      state,
      selectedParticipantId,
      currentParticipant:
        state.participants.find((participant) => participant.id === selectedParticipantId) ?? null,
      currentSlide,
      timerView: getTimerView(state.live.timer, clock),
      backendPhase: 'ready',
      backendError: null,
      authRole: selectedParticipantId ? 'participant' : 'owner',
      authEmail: null,
      dispatch,
      dispatchAsync: async <T,>(command: PlatformCommand) => dispatch<T>(command),
      joinParticipant,
      revealParticipantPin: async (participantId) => {
        const participant = stateRef.current.participants.find((item) => item.id === participantId)
        return participant
          ? { ok: true, value: participant.pin }
          : commandError('참여자를 찾을 수 없습니다.')
      },
      savePrivateDraft: async () => true,
      selectParticipant,
      signInOrganizer: async () => ({ ok: true, value: undefined }),
      signOut: async () => selectParticipant(null),
    }
  }, [clock, dispatch, joinParticipant, selectParticipant, selectedParticipantId, state])

  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>
}

function toFirebaseCommand(
  command: PlatformCommand,
  state: PrototypeState,
): FirebaseAuthoritativeCommand | null {
  switch (command.type) {
    case 'SET_ACTIVE_SLIDE': {
      const slide = state.slides[command.slideIndex]
      return slide ? { type: 'SET_ACTIVE_SLIDE', slideId: slide.id } : null
    }
    case 'CREATE_SLIDE':
      return { type: command.type, ...command.input }
    case 'DELETE_SLIDE':
      return { type: command.type, slideId: command.slideId }
    case 'MOVE_SLIDE':
      return { type: command.type, slideId: command.slideId, direction: command.direction }
    case 'REORDER_SLIDES':
      return { type: command.type, orderedSlideIds: command.orderedSlideIds }
    case 'END_SESSION':
      return { type: command.type }
    case 'SET_TIMER_DURATION':
      return { type: command.type, durationSec: command.durationSec }
    case 'START_SESSION':
    case 'START_TIMER':
    case 'PAUSE_TIMER':
    case 'RESUME_TIMER':
    case 'RESET_TIMER':
      return { type: command.type }
    case 'SET_ANSWERS_REVEALED':
      return { type: command.type, slideId: command.slideId, revealed: command.revealed }
    case 'SET_COMMENTS_ENABLED':
      return { type: command.type, slideId: command.slideId, enabled: command.enabled }
    case 'UPDATE_SLIDE':
      return { type: command.type, ...command.input }
    case 'ADD_COMMENT':
      return { type: command.type, answerId: command.input.answerId, body: command.input.body }
    case 'SET_LIVE_REACTION':
      return { type: command.type, slideId: command.input.slideId, kind: command.input.kind }
    case 'SEND_LIVE_CHAT_MESSAGE':
      return {
        type: command.type,
        slideId: command.input.slideId,
        body: command.input.body,
        replyToId: command.input.replyToId,
      }
    case 'DELETE_LIVE_CHAT_MESSAGE':
      return { type: command.type, messageId: command.input.messageId }
    case 'UPDATE_COMMENT':
      return { type: command.type, commentId: command.input.commentId, body: command.input.body }
    case 'DELETE_COMMENT':
      return { type: command.type, commentId: command.input.commentId }
    case 'ADD_REVIEW_THREAD':
      return { type: command.type, ...command.input }
    case 'ADD_REVIEW_REPLY':
      return { type: command.type, threadId: command.input.threadId, body: command.input.body }
    case 'SET_REVIEW_THREAD_STATUS':
      return { type: command.type, threadId: command.input.threadId, status: command.input.status }
    case 'INVITE_ADMIN':
      return { type: command.type, email: command.email }
    case 'REVOKE_ADMIN':
      return { type: command.type, inviteId: command.inviteId }
    case 'PUBLISH_SYNTHESIS':
      return { type: command.type }
    case 'SET_EXHIBITION_PUBLISHED':
      return { type: command.type, published: command.published }
    default:
      return null
  }
}

function FirebasePlatformProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const routeEventId = eventIdFromPath(pathname)
  const directoryMode = pathname === '/admin/sessions'
  const standaloneRoute = pathname === '/'
    || pathname === '/ebook'
    || directoryMode
    || pathname.startsWith('/admin/invites/')
  const publicOnlyRoute = standaloneRoute
    || pathname.startsWith('/join/')
    || pathname.startsWith('/dashboards/')
    || pathname.startsWith('/embed/')
    || pathname.startsWith('/exhibitions/')
  const activeEventId = routeEventId ?? LEGACY_EVENT_ID
  const activePublicSlug = publicSlugFromPath(pathname, routeEventId)
  const seedRef = useRef(createEmptyState())
  const [state, setState] = useState(seedRef.current)
  const stateRef = useRef(state)
  const backendRef = useRef<FirebaseBackend | null>(null)
  const [session, setSession] = useState<FirebaseAuthSession | null>(null)
  const [membership, setMembership] = useState<FirebaseEventMembership | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [backendPhase, setBackendPhase] = useState<PlatformBackendPhase>('loading')
  const [backendError, setBackendError] = useState<string | null>(null)
  const [loadedProjectionKey, setLoadedProjectionKey] = useState<string | null>(null)
  const [clock, setClock] = useState(() => Date.now())

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => observeFirebaseAuthSession(
    (nextSession) => {
      setSession(nextSession)
      setAuthReady(true)
      if (!nextSession) setMembership(null)
    },
    (cause) => {
      setBackendError(cause.message)
      setBackendPhase('error')
      setAuthReady(true)
    },
  ), [])

  useEffect(() => {
    if (!session) return
    if (publicOnlyRoute) {
      setMembership(null)
      return
    }
    if (session.role === 'participant' && routeEventId && session.eventId !== routeEventId) {
      setMembership(null)
      return
    }
    const membershipEventId = session.role === 'participant'
      ? (session.eventId ?? activeEventId)
      : activeEventId
    return observeFirebaseEventMembership(
      membershipEventId,
      session.uid,
      (nextMembership) => {
        setMembership(nextMembership)
        if (nextMembership.status !== 'active') void signOutFirebase()
      },
      () => setMembership(null),
    )
  }, [activeEventId, publicOnlyRoute, routeEventId, session])

  const activeMembership = membership?.status === 'active' && membership.eventId === activeEventId
    ? membership
    : null
  const projection = !publicOnlyRoute && (activeMembership?.role === 'owner' || activeMembership?.role === 'admin')
    ? { role: 'organizer' as const, participantId: undefined }
    : !publicOnlyRoute && activeMembership?.role === 'participant'
      ? { role: 'participant' as const, participantId: activeMembership.participantId ?? activeMembership.uid }
      : { role: 'public' as const, participantId: undefined }

  const includePublishedSnapshot = pathname.startsWith('/dashboards/')
    || pathname.startsWith('/embed/')
    || pathname.startsWith('/exhibitions/')
    || pathname.endsWith('/synthesis')
    || pathname.endsWith('/portability')
  const projectionKey = [
    projection.role,
    activeEventId,
    activePublicSlug,
    projection.participantId ?? '',
    includePublishedSnapshot ? 'published' : 'live',
  ].join(':')

  useEffect(() => {
    if (!authReady) return
    if (standaloneRoute) {
      backendRef.current = null
      setBackendError(null)
      setBackendPhase('ready')
      setLoadedProjectionKey(null)
      return
    }
    setBackendPhase('loading')
    setBackendError(null)
    setLoadedProjectionKey(null)
    const backend = createFirebaseEventBackend({
      eventId: activeEventId,
      includePublishedSnapshot,
      participantId: projection.participantId,
      publicSlug: activePublicSlug,
      role: projection.role,
    })
    backendRef.current = backend
    let connectionTimeout = window.setTimeout(() => {
      connectionTimeout = 0
      setBackendError('Google/Firebase 서버에 연결할 수 없습니다. 인터넷·DNS·VPN·광고 차단 설정에서 google.com과 googleapis.com 접속을 확인해주세요.')
      setBackendPhase('error')
    }, 12_000)
    const clearConnectionTimeout = () => {
      if (!connectionTimeout) return
      window.clearTimeout(connectionTimeout)
      connectionTimeout = 0
    }
    const unsubscribe = backend.subscribe((snapshot) => {
      stateRef.current = snapshot.state
      setState(snapshot.state)
      setClock(Date.now())
      setLoadedProjectionKey(projectionKey)
      if (!snapshot.fromCache) {
        clearConnectionTimeout()
        setBackendPhase('ready')
      }
    }, (cause) => {
      clearConnectionTimeout()
      setBackendError(cause.message)
      setBackendPhase('error')
    })
    return () => {
      clearConnectionTimeout()
      backendRef.current = null
      unsubscribe()
    }
  }, [activeEventId, activePublicSlug, authReady, includePublishedSnapshot, projection.participantId, projection.role, projectionKey, standaloneRoute])

  useEffect(() => {
    if (state.live.timer.status !== 'running') return
    const interval = window.setInterval(() => setClock(Date.now()), 1_000)
    return () => window.clearInterval(interval)
  }, [state.live.timer.status, state.live.timer.endsAt])

  const runRemoteCommand = useCallback(async <T,>(command: PlatformCommand): Promise<CommandResult<T>> => {
    const backend = backendRef.current
    if (!backend) return commandError('Firebase 연결을 준비하고 있습니다.')
    try {
      if (command.type === 'SAVE_ANSWER') {
        const write = backend.saveAnswerDraft({
          baseRevision: command.input.baseRevision ?? 0,
          content: command.input.content,
          slideId: command.input.slideId,
        })
        const status = await write.confirmation
        if (status.phase === 'rejected') throw status.error ?? new Error('답변 초안을 저장하지 못했습니다.')
        if (command.input.submit === false) {
          return { ok: true, value: undefined as T, notice: '답변 초안을 Firebase에 저장했어요.' }
        }
        const response = await backend.execute<T>({ type: 'SUBMIT_ANSWER', slideId: command.input.slideId })
        return { ok: true, value: response.value, notice: response.notice }
      }
      if (command.type === 'SUBMIT_PROJECT') {
        const write = backend.saveProjectDraft({
          baseRevision: command.input.baseRevision ?? 0,
          coverImage: command.input.coverImage,
          title: command.input.title,
          pitch: command.input.pitch,
          description: command.input.description,
          demoUrl: command.input.demoUrl,
          githubUrl: command.input.githubUrl,
          tags: command.input.tags,
          retrospective: command.input.retrospective,
        })
        const status = await write.confirmation
        if (status.phase === 'rejected') throw status.error ?? new Error('작품 초안을 저장하지 못했습니다.')
        if (command.input.submit === false) {
          return { ok: true, value: undefined as T, notice: '작품 초안을 Firebase에 저장했어요.' }
        }
        const response = await backend.execute<T>({ type: 'SUBMIT_PROJECT' })
        return { ok: true, value: response.value, notice: response.notice }
      }
      if (command.type === 'UPDATE_SYNTHESIS') {
        const response = await backend.execute<T>({ type: 'UPDATE_SYNTHESIS', ...command.input })
        return { ok: true, value: response.value, notice: response.notice }
      }
      if (command.type === 'INVITE_ADMIN') {
        const response = await backend.execute<{ email: string; id: string }>({
          type: 'INVITE_ADMIN',
          email: command.email,
        })
        await sendAdminInviteEmailLink(response.value.email, response.value.id, activeEventId)
        return {
          ok: true,
          value: response.value as T,
          notice: '초대 메일을 보냈어요. 받은 사람은 동일한 Google 계정으로만 권한을 수락할 수 있어요.',
        }
      }
      const remote = toFirebaseCommand(command, stateRef.current)
      if (!remote) return commandError('이 작업은 Firebase 운영 모드에서 지원되지 않습니다.')
      const response = await backend.execute<T>(remote)
      return { ok: true, value: response.value, notice: response.notice }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Firebase 요청을 완료하지 못했습니다.'
      setBackendError(message)
      return commandError(message)
    }
  }, [activeEventId])

  const dispatch = useCallback(<T,>(command: PlatformCommand): CommandResult<T> => {
    void runRemoteCommand<T>(command)
    return { ok: true, value: undefined as T, notice: 'Firebase에 요청을 전송했어요.' }
  }, [runRemoteCommand])

  const joinParticipant = useCallback(async (input: JoinParticipantInput): Promise<CommandResult<Participant>> => {
    try {
      const result = await joinParticipantWithPin(input)
      setSession(result.session)
      setMembership({
        eventId: result.eventId,
        participantId: result.participantId,
        role: 'participant',
        status: 'active',
        uid: result.session.uid,
      })
      return {
        ok: true,
        notice: result.notice ?? 'Firebase에 연결해 입장했어요.',
        value: {
          id: result.participantId,
          eventId: result.eventId,
          nickname: input.nickname.trim(),
          normalizedNickname: input.nickname.trim().toLocaleLowerCase('ko-KR'),
          pin: '',
          joinedAt: new Date().toISOString(),
          lastSeenAt: new Date().toISOString(),
          status: 'online',
          accent: '#3157C8',
        },
      }
    } catch (cause) {
      return commandError(cause instanceof Error ? cause.message : '참여 인증에 실패했습니다.')
    }
  }, [])

  const signInOrganizer = useCallback(async (): Promise<CommandResult<undefined>> => {
    try {
      const nextSession = await signInOrganizerWithGoogle()
      setSession(nextSession)
      if (directoryMode) {
        return { ok: true, value: undefined, notice: '주최자 세션 목록을 열었어요.' }
      }
      let nextMembership: FirebaseEventMembership
      try {
        nextMembership = await resolveFirebaseEventMembership(activeEventId, nextSession.uid)
      } catch {
        if (activeEventId !== LEGACY_EVENT_ID) throw new Error('이 세션에 대한 주최자 권한이 없습니다.')
        await bootstrapVibe26Event()
        nextMembership = await resolveFirebaseEventMembership(activeEventId, nextSession.uid)
      }
      if (
        nextMembership.status !== 'active'
        || (nextMembership.role !== 'owner' && nextMembership.role !== 'admin')
      ) {
        await signOutFirebase()
        return commandError('이 계정에는 주최자 권한이 없습니다.')
      }
      setMembership(nextMembership)
      return { ok: true, value: undefined, notice: '주최자 Firebase 계정으로 연결됐어요.' }
    } catch (cause) {
      return commandError(cause instanceof Error ? cause.message : '주최자 로그인에 실패했습니다.')
    }
  }, [activeEventId, directoryMode])

  const revealParticipantPin = useCallback(async (
    participantId: string,
    reason: string,
  ): Promise<CommandResult<string>> => {
    try {
      const result = await backendRef.current?.revealParticipantPin(participantId, reason)
      if (!result) return commandError('Firebase 연결을 준비하고 있습니다.')
      return { ok: true, value: result.pin, notice: '감사 기록을 남기고 PIN을 확인했어요.' }
    } catch (cause) {
      return commandError(cause instanceof Error ? cause.message : 'PIN을 확인하지 못했습니다.')
    }
  }, [])

  const savePrivateDraft = useCallback(async (
    targetType: 'comment' | 'comment-edit' | 'review-composer' | 'review-reply',
    targetId: string,
    payload: Record<string, unknown>,
  ): Promise<boolean> => {
    try {
      const backend = backendRef.current
      if (!backend) return false
      const write = backend.savePrivateDraft({ payload, targetId, targetType })
      return (await write.confirmation).phase === 'confirmed'
    } catch {
      return false
    }
  }, [])

  const signOut = useCallback(async () => {
    await signOutFirebase()
    setMembership(null)
    setSession(null)
  }, [])

  const selectedParticipantId = activeMembership?.role === 'participant'
    ? (activeMembership.participantId ?? activeMembership.uid)
    : null
  const currentSlide = state.slides[state.live.activeSlideIndex] ?? state.slides[0] ?? seedRef.current.slides[0]
  const value = useMemo<PlatformContextValue>(() => ({
    state,
    selectedParticipantId,
    currentParticipant: state.participants.find((participant) => participant.id === selectedParticipantId) ?? null,
    currentSlide,
    timerView: getTimerView(state.live.timer, clock),
    backendPhase,
    backendError,
    authRole: directoryMode && session?.email ? 'owner' : activeMembership?.role ?? null,
    authEmail: session?.email ?? null,
    dispatch,
    dispatchAsync: runRemoteCommand,
    joinParticipant,
    revealParticipantPin,
    savePrivateDraft,
    selectParticipant: () => undefined,
    signInOrganizer,
    signOut,
  }), [
    backendError,
    backendPhase,
    clock,
    currentSlide,
    directoryMode,
    dispatch,
    activeMembership?.role,
    joinParticipant,
    revealParticipantPin,
    savePrivateDraft,
    runRemoteCommand,
    selectedParticipantId,
    session,
    signInOrganizer,
    signOut,
    state,
  ])

  const projectionReady = standaloneRoute || loadedProjectionKey === projectionKey

  if (backendPhase === 'error') {
    return (
      <div className="firebase-boundary firebase-boundary--error" role="alert">
        <span className="material-symbols-rounded" aria-hidden="true">cloud_off</span>
        <h1>Firebase 데이터를 불러오지 못했습니다</h1>
        <p>{backendError ?? '네트워크와 행사 권한을 확인한 뒤 다시 시도해주세요.'}</p>
        <button onClick={() => window.location.reload()} type="button">다시 연결</button>
      </div>
    )
  }

  if (backendPhase === 'loading' || !projectionReady) {
    return (
      <div className="firebase-boundary" role="status">
        <span className="material-symbols-rounded" aria-hidden="true">cloud_sync</span>
        <h1>Firebase 행사 데이터를 불러오고 있어요</h1>
        <p>{membership ? '인증된 행사 자료를 안전하게 동기화하고 있습니다.' : '처음 설정하는 주최자라면 Google 계정으로 연결해주세요.'}</p>
        {!membership && !publicOnlyRoute ? <button onClick={() => { void signInOrganizer() }} type="button">Google로 주최자 연결</button> : null}
      </div>
    )
  }

  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>
}

export function PlatformProvider({ children }: { children: ReactNode }) {
  return import.meta.env.MODE === 'test'
    ? <LocalPlatformProvider>{children}</LocalPlatformProvider>
    : <FirebasePlatformProvider>{children}</FirebasePlatformProvider>
}

export function usePlatform(): PlatformContextValue {
  const value = useContext(PlatformContext)
  if (!value) throw new Error('usePlatform must be used within PlatformProvider')
  return value
}

export { draftPhase }
