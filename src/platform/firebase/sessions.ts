import { collection, doc, onSnapshot } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { FIREBASE_CALLABLES } from './auth'
import { getFirebaseServices, type FirebaseServices } from './config'

export interface OrganizerSessionSummary {
  dashboardPublished: boolean
  eventDate: string
  eventId: string
  exhibitionPublished: boolean
  lifecycle: 'lobby' | 'live' | 'ended'
  participantCount: number
  publicSlug: string
  role: 'owner' | 'admin'
  roomCode: string
  title: string
  updatedAt: string
}

export interface CreateSessionInput {
  eventDate: string
  tagline: string
  title: string
}

export interface CreateSessionResult {
  eventId: string
  publicSlug: string
  roomCode: string
  title: string
}

function asDate(value: unknown): string {
  if (value && typeof value === 'object' && 'toDate' in value) {
    const toDate = (value as { toDate?: unknown }).toDate
    if (typeof toDate === 'function') return (toDate.call(value) as Date).toISOString()
  }
  return typeof value === 'string' ? value : new Date(0).toISOString()
}

export async function createHackathonSession(
  input: CreateSessionInput,
  services: FirebaseServices = getFirebaseServices(),
): Promise<CreateSessionResult> {
  if (!services.auth.currentUser) throw new Error('주최자 로그인 후 세션을 만들어주세요.')
  const callable = httpsCallable<CreateSessionInput, Partial<CreateSessionResult>>(
    services.functions,
    FIREBASE_CALLABLES.createHackathonSession,
  )
  const result = (await callable(input)).data
  if (
    typeof result.eventId !== 'string'
    || typeof result.publicSlug !== 'string'
    || typeof result.roomCode !== 'string'
    || typeof result.title !== 'string'
  ) {
    throw new Error('세션 생성 서버가 올바르지 않은 응답을 반환했습니다.')
  }
  return result as CreateSessionResult
}

export function observeOrganizerSessions(
  listener: (sessions: OrganizerSessionSummary[]) => void,
  onError: (cause: Error) => void,
  services: FirebaseServices = getFirebaseServices(),
): () => void {
  const user = services.auth.currentUser
  if (!user) {
    listener([])
    return () => undefined
  }
  let active = true
  const eventUnsubscribes = new Map<string, () => void>()
  const eventRoles = new Map<string, 'owner' | 'admin'>()
  const records = new Map<string, OrganizerSessionSummary>()
  const emit = () => {
    if (!active) return
    listener([...records.values()]
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)))
  }
  const stopEvent = (eventId: string) => {
    eventUnsubscribes.get(eventId)?.()
    eventUnsubscribes.delete(eventId)
    eventRoles.delete(eventId)
    records.delete(eventId)
  }
  const unsubscribe = onSnapshot(collection(services.db, `users/${user.uid}/memberships`), (snapshot) => {
    const nextRoles = new Map<string, 'owner' | 'admin'>()
    snapshot.docs.forEach((membership) => {
      const membershipData = membership.data()
      if (membershipData.status !== 'active') return
      const role = membershipData.role === 'admin' ? 'admin' : membershipData.role === 'owner' ? 'owner' : null
      if (role) nextRoles.set(membership.id, role)
    })

    eventUnsubscribes.forEach((_stop, eventId) => {
      if (!nextRoles.has(eventId)) stopEvent(eventId)
    })
    nextRoles.forEach((role, eventId) => {
      if (eventRoles.get(eventId) === role && eventUnsubscribes.has(eventId)) return
      stopEvent(eventId)
      eventRoles.set(eventId, role)
      eventUnsubscribes.set(eventId, onSnapshot(doc(services.db, `events/${eventId}`), (event) => {
        if (!event.exists()) {
          records.delete(eventId)
          emit()
          return
        }
        const data = event.data()
        const lifecycle = data.lifecycle === 'ended' ? 'ended' : data.lifecycle === 'live' ? 'live' : 'lobby'
        records.set(eventId, {
          dashboardPublished: Number(data.publishedRevision ?? 0) > 0,
          eventDate: typeof data.eventDate === 'string' ? data.eventDate : '',
          eventId,
          exhibitionPublished: data.exhibitionPublished === true,
          lifecycle,
          participantCount: typeof data.participantCount === 'number' ? data.participantCount : 0,
          publicSlug: typeof data.publicSlug === 'string' ? data.publicSlug : '',
          role,
          roomCode: typeof data.code === 'string' ? data.code : '',
          title: typeof data.title === 'string' ? data.title : '이름 없는 세션',
          updatedAt: asDate(data.updatedAt),
        })
        emit()
      }, (cause) => onError(cause)))
    })
    if (records.size || nextRoles.size === 0) emit()
  }, (cause) => onError(cause))
  return () => {
    active = false
    unsubscribe()
    eventUnsubscribes.forEach((stop) => stop())
    eventUnsubscribes.clear()
  }
}
