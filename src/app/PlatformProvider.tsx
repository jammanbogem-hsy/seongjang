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
  Participant,
  PlatformCommand,
  PrototypeState,
  Slide,
  TimerView,
} from '../domain/models'
import { createSeedState } from '../domain/seed'
import {
  createBrowserPersistence,
  getSelectedParticipantId,
  setSelectedParticipantId,
  type PlatformPersistence,
} from '../platform/persistence'

export interface PlatformContextValue {
  state: PrototypeState
  selectedParticipantId: string | null
  currentParticipant: Participant | null
  currentSlide: Slide
  timerView: TimerView
  dispatch: <T = unknown>(command: PlatformCommand) => CommandResult<T>
  selectParticipant: (participantId: string | null) => void
}

const PlatformContext = createContext<PlatformContextValue | null>(null)

function makePersistence(): PlatformPersistence | null {
  return typeof window === 'undefined' ? null : createBrowserPersistence()
}

export function PlatformProvider({ children }: { children: ReactNode }) {
  const persistenceRef = useRef<PlatformPersistence | null>(null)
  if (persistenceRef.current === null && typeof window !== 'undefined') {
    persistenceRef.current = makePersistence()
  }

  const [state, setState] = useState<PrototypeState>(() =>
    persistenceRef.current?.load() ?? createSeedState(),
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
    const interval = window.setInterval(() => setClock(Date.now()), 1000)
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

  const value = useMemo<PlatformContextValue>(() => {
    const currentSlide = state.slides[state.live.activeSlideIndex] ?? state.slides[0]
    return {
      state,
      selectedParticipantId,
      currentParticipant:
        state.participants.find((participant) => participant.id === selectedParticipantId) ?? null,
      currentSlide,
      timerView: getTimerView(state.live.timer, clock),
      dispatch,
      selectParticipant,
    }
  }, [clock, dispatch, selectParticipant, selectedParticipantId, state])

  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>
}

export function usePlatform(): PlatformContextValue {
  const value = useContext(PlatformContext)
  if (!value) throw new Error('usePlatform must be used within PlatformProvider')
  return value
}
