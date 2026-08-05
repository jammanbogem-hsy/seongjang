import { PROTOTYPE_SCHEMA_VERSION, type PrototypeState } from '../domain/models'
import { freezePublishedSnapshot } from '../domain/publicProjection'

export const PLATFORM_STORAGE_KEY = 'vibecoding.prototype.event.v1'
export const PARTICIPANT_SESSION_KEY = 'vibecoding.prototype.participant.v1'
const CHANNEL_NAME = 'vibecoding.prototype.live.v1'

export interface PlatformPersistence {
  load: () => PrototypeState | null
  save: (state: PrototypeState) => void
  clear: () => void
  subscribe: (listener: (state: PrototypeState) => void) => () => void
  close: () => void
}

interface RevisionMessage {
  type: 'revision'
  revision: number
  sourceId: string
}

function isPrototypeState(value: unknown): value is PrototypeState {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<PrototypeState>
  return (
    candidate.schemaVersion === PROTOTYPE_SCHEMA_VERSION &&
    typeof candidate.revision === 'number' &&
    Array.isArray(candidate.participants) &&
    Array.isArray(candidate.slides) &&
    Array.isArray(candidate.answers) &&
    typeof candidate.room?.code === 'string' &&
    typeof candidate.live?.activeSlideIndex === 'number'
  )
}

function parseState(serialized: string | null): PrototypeState | null {
  if (!serialized) return null
  try {
    const value: unknown = JSON.parse(serialized)
    if (!isPrototypeState(value)) return null
    const normalized: PrototypeState = {
      ...value,
      reviewThreads: Array.isArray(value.reviewThreads) ? value.reviewThreads : [],
    }
    if (normalized.publishedSnapshot) freezePublishedSnapshot(normalized.publishedSnapshot)
    return normalized
  } catch {
    return null
  }
}

function browserSourceId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function createBrowserPersistence(): PlatformPersistence {
  const canUseStorage = typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
  const sourceId = browserSourceId()
  const channel =
    typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME)
  const listeners = new Set<(state: PrototypeState) => void>()

  const load = (): PrototypeState | null => {
    if (!canUseStorage) return null
    return parseState(window.localStorage.getItem(PLATFORM_STORAGE_KEY))
  }

  const notifyFromStorage = () => {
    const state = load()
    if (state) listeners.forEach((listener) => listener(state))
  }

  const onMessage = (event: MessageEvent<RevisionMessage>) => {
    if (
      event.data?.type === 'revision' &&
      event.data.sourceId !== sourceId &&
      Number.isFinite(event.data.revision)
    ) {
      notifyFromStorage()
    }
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key === PLATFORM_STORAGE_KEY && event.newValue) {
      const state = parseState(event.newValue)
      if (state) listeners.forEach((listener) => listener(state))
    }
  }

  channel?.addEventListener('message', onMessage)
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)

  return {
    load,
    save: (state) => {
      if (!canUseStorage) return
      window.localStorage.setItem(PLATFORM_STORAGE_KEY, JSON.stringify(state))
      channel?.postMessage({ type: 'revision', revision: state.revision, sourceId } satisfies RevisionMessage)
    },
    clear: () => {
      if (canUseStorage) window.localStorage.removeItem(PLATFORM_STORAGE_KEY)
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    close: () => {
      channel?.removeEventListener('message', onMessage)
      channel?.close()
      if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
      listeners.clear()
    },
  }
}

export function getSelectedParticipantId(): string | null {
  if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') return null
  return window.sessionStorage.getItem(PARTICIPANT_SESSION_KEY)
}

export function setSelectedParticipantId(participantId: string | null): void {
  if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') return
  if (participantId) window.sessionStorage.setItem(PARTICIPANT_SESSION_KEY, participantId)
  else window.sessionStorage.removeItem(PARTICIPANT_SESSION_KEY)
}
