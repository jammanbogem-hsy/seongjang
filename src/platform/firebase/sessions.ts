import { collection, doc, getDoc, onSnapshot } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { FIREBASE_CALLABLES } from './auth'
import { getFirebaseServices, type FirebaseServices } from './config'

export interface OrganizerSessionSummary {
  eventDate: string
  eventId: string
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
  const unsubscribe = onSnapshot(collection(services.db, `users/${user.uid}/memberships`), (snapshot) => {
    void Promise.all(snapshot.docs.map(async (membership) => {
      const membershipData = membership.data()
      if (membershipData.status !== 'active') return null
      const role = membershipData.role === 'admin' ? 'admin' : membershipData.role === 'owner' ? 'owner' : null
      if (!role) return null
      const eventId = membership.id
      const event = await getDoc(doc(services.db, `events/${eventId}`))
      if (!event.exists()) return null
      const data = event.data()
      const lifecycle = data.lifecycle === 'ended' ? 'ended' : data.lifecycle === 'live' ? 'live' : 'lobby'
      return {
        eventDate: typeof data.eventDate === 'string' ? data.eventDate : '',
        eventId,
        lifecycle,
        participantCount: typeof data.participantCount === 'number' ? data.participantCount : 0,
        publicSlug: typeof data.publicSlug === 'string' ? data.publicSlug : '',
        role,
        roomCode: typeof data.code === 'string' ? data.code : '',
        title: typeof data.title === 'string' ? data.title : '이름 없는 세션',
        updatedAt: asDate(data.updatedAt),
      } satisfies OrganizerSessionSummary
    })).then((records) => {
      if (!active) return
      listener(records.filter((record): record is OrganizerSessionSummary => record !== null)
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)))
    }).catch((cause) => onError(cause instanceof Error ? cause : new Error('세션 목록을 불러오지 못했습니다.')))
  }, (cause) => onError(cause))
  return () => {
    active = false
    unsubscribe()
  }
}
