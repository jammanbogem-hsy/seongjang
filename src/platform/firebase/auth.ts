import {
  GoogleAuthProvider,
  getIdTokenResult,
  isSignInWithEmailLink,
  onIdTokenChanged,
  sendSignInLinkToEmail,
  signInAnonymously,
  signInWithCustomToken,
  signInWithEmailLink,
  signInWithPopup,
  signOut,
  type User,
  type UserCredential,
} from 'firebase/auth'
import { httpsCallable } from 'firebase/functions'
import { getFirebaseServices, type FirebaseServices } from './config'
import { createFirebaseSdkDriver, type FirebaseBackendDriver } from './driver'
import { clearSensitiveBrowserState } from '../securityStorage'

export const FIREBASE_CALLABLES = Object.freeze({
  applyEventCommand: 'applyEventCommand',
  applyReviewCommand: 'applyReviewCommand',
  bootstrapVibe26: 'bootstrapVibe26',
  joinParticipantWithPin: 'joinOrReenterParticipant',
  manageJoinAccessCode: 'manageJoinAccessCode',
  revealParticipantPin: 'revealParticipantPin',
})

export type FirebaseSessionRole = 'owner' | 'admin' | 'participant' | null

export interface FirebaseAuthSession {
  email: string | null
  eventId: string | null
  participantId: string | null
  role: FirebaseSessionRole
  uid: string
}

export interface ParticipantJoinRequest {
  deviceId?: string
  entryCode?: string
  nickname: string
  pin: string
  roomCode: string
}

const PARTICIPANT_DEVICE_ID_KEY = 'vibecoding.participant-device-id'

function participantDeviceId(): string {
  if (typeof window === 'undefined') return 'server-render'
  const existing = window.localStorage.getItem(PARTICIPANT_DEVICE_ID_KEY)
  if (existing) return existing
  const created = `web-${crypto.randomUUID()}`
  window.localStorage.setItem(PARTICIPANT_DEVICE_ID_KEY, created)
  return created
}

export interface ParticipantJoinResult {
  eventId: string
  notice?: string
  participantId: string
  session: FirebaseAuthSession
}

export interface FirebaseEventMembership {
  eventId: string
  participantId: string | null
  role: Exclude<FirebaseSessionRole, null>
  status: 'active' | 'disabled' | 'invited' | 'revoked'
  uid: string
}

export interface BootstrapVibe26Result {
  created: boolean
  eventId: string
}

function membershipFromDocument(
  eventId: string,
  uid: string,
  data: Record<string, unknown> | undefined,
): FirebaseEventMembership {
  if (!data) throw new Error('이 행사에 대한 접근 권한이 없습니다.')
  const role = roleClaim(data.role)
  if (!role) throw new Error('행사 역할 정보가 올바르지 않습니다.')
  const status = data.status === 'disabled' || data.status === 'invited' || data.status === 'revoked'
    ? data.status
    : 'active'
  return {
    eventId,
    participantId: role === 'participant'
      ? (textClaim(data.participantId) ?? textClaim(data.uid) ?? uid)
      : null,
    role,
    status,
    uid,
  }
}

export function observeFirebaseEventMembership(
  eventId: string,
  uid: string,
  next: (membership: FirebaseEventMembership) => void,
  error: (cause: Error) => void,
  driver: FirebaseBackendDriver = createFirebaseSdkDriver(),
): () => void {
  return driver.watchDocument(
    `events/${eventId}/members/${uid}`,
    (snapshot) => {
      try {
        next(membershipFromDocument(eventId, uid, snapshot.document?.data))
      } catch (cause) {
        error(cause instanceof Error ? cause : new Error('행사 권한 정보를 확인하지 못했습니다.'))
      }
    },
    error,
  )
}

interface JoinCallableResult {
  customToken?: unknown
  eventId?: unknown
  notice?: unknown
  participant?: unknown
  participantId?: unknown
  reentered?: unknown
}

function textClaim(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function roleClaim(value: unknown): FirebaseSessionRole {
  return value === 'owner' || value === 'admin' || value === 'participant' ? value : null
}

async function sessionFor(user: User): Promise<FirebaseAuthSession> {
  const token = await getIdTokenResult(user)
  return {
    email: user.email,
    eventId: textClaim(token.claims.eventId),
    participantId: token.claims.actorType === 'participant'
      ? (textClaim(token.claims.participantId) ?? user.uid)
      : textClaim(token.claims.participantId),
    role: token.claims.actorType === 'participant'
      ? 'participant'
      : roleClaim(token.claims.eventRole ?? token.claims.role),
    uid: user.uid,
  }
}

export async function signInOrganizerWithGoogle(
  services: FirebaseServices = getFirebaseServices(),
): Promise<FirebaseAuthSession> {
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })
  const credential = await signInWithPopup(services.auth, provider)
  return sessionFor(credential.user)
}

export async function bootstrapVibe26Event(
  services: FirebaseServices = getFirebaseServices(),
): Promise<BootstrapVibe26Result> {
  if (!services.auth.currentUser) throw new Error('행사를 만들려면 Google 계정 로그인이 필요합니다.')
  const callable = httpsCallable<Record<string, never>, Partial<BootstrapVibe26Result>>(
    services.functions,
    FIREBASE_CALLABLES.bootstrapVibe26,
  )
  const response = (await callable({})).data
  if (typeof response.eventId !== 'string' || typeof response.created !== 'boolean') {
    throw new Error('행사 초기화 서버가 올바르지 않은 응답을 반환했습니다.')
  }
  return { created: response.created, eventId: response.eventId }
}

export function resolveFirebaseEventMembership(
  eventId: string,
  uid: string,
  driver: FirebaseBackendDriver = createFirebaseSdkDriver(),
): Promise<FirebaseEventMembership> {
  return new Promise((resolve, reject) => {
    let settled = false
    let unsubscribe: () => void = () => undefined
    const finish = (action: () => void) => {
      if (settled) return
      settled = true
      action()
      queueMicrotask(() => unsubscribe())
    }
    unsubscribe = observeFirebaseEventMembership(
      eventId,
      uid,
      (membership) => finish(() => resolve(membership)),
      (cause) => finish(() => reject(cause)),
      driver,
    )
  })
}

export async function joinParticipantWithPin(
  request: ParticipantJoinRequest,
  services: FirebaseServices = getFirebaseServices(),
): Promise<ParticipantJoinResult> {
  // The callable rate limiter keys new registrations to this server-verified
  // Firebase identity. The custom participant token replaces it after join.
  if (!services.auth.currentUser) await signInAnonymously(services.auth)
  const callable = httpsCallable<ParticipantJoinRequest, JoinCallableResult>(
    services.functions,
    FIREBASE_CALLABLES.joinParticipantWithPin,
  )
  const response = (await callable({
    deviceId: request.deviceId ?? participantDeviceId(),
    entryCode: request.entryCode ?? '',
    nickname: request.nickname,
    pin: request.pin,
    roomCode: request.roomCode,
  })).data
  const participant = response.participant && typeof response.participant === 'object'
    ? response.participant as Record<string, unknown>
    : {}
  const participantId = typeof response.participantId === 'string'
    ? response.participantId
    : participant.id
  if (
    typeof response.customToken !== 'string' ||
    typeof response.eventId !== 'string' ||
    typeof participantId !== 'string'
  ) {
    throw new Error('참여 인증 서버가 올바르지 않은 응답을 반환했습니다.')
  }
  const credential: UserCredential = await signInWithCustomToken(services.auth, response.customToken)
  return {
    eventId: response.eventId,
    notice: typeof response.notice === 'string' ? response.notice : undefined,
    participantId,
    session: await sessionFor(credential.user),
  }
}

export async function sendAdminInviteEmailLink(
  email: string,
  inviteId: string,
  eventId: string,
  services: FirebaseServices = getFirebaseServices(),
): Promise<void> {
  const url = new URL(`/admin/invites/${encodeURIComponent(inviteId)}`, window.location.origin)
  url.searchParams.set('eventId', eventId)
  await sendSignInLinkToEmail(services.auth, email, {
    url: url.toString(),
    handleCodeInApp: true,
  })
}

export function isAdminInviteEmailLink(href = window.location.href): boolean {
  return isSignInWithEmailLink(getFirebaseServices().auth, href)
}

export async function acceptAdminInviteEmailLink(
  email: string,
  inviteId: string,
  eventId: string,
  href = window.location.href,
  services: FirebaseServices = getFirebaseServices(),
): Promise<FirebaseAuthSession> {
  if (!isSignInWithEmailLink(services.auth, href)) {
    throw new Error('유효한 관리자 초대 링크가 아닙니다.')
  }
  const credential = await signInWithEmailLink(services.auth, email.trim(), href)
  const callable = httpsCallable<
    { command: { inviteId: string; type: 'ACCEPT_ADMIN_INVITE' }; eventId: string },
    { ok?: boolean }
  >(services.functions, FIREBASE_CALLABLES.applyEventCommand)
  await callable({ eventId, command: { type: 'ACCEPT_ADMIN_INVITE', inviteId } })
  await credential.user.getIdToken(true)
  return sessionFor(credential.user)
}

export function observeFirebaseAuthSession(
  listener: (session: FirebaseAuthSession | null) => void,
  onError: (cause: Error) => void = () => undefined,
  services: FirebaseServices = getFirebaseServices(),
): () => void {
  return onIdTokenChanged(
    services.auth,
    (user) => {
      if (!user) {
        listener(null)
        return
      }
      void sessionFor(user).then(listener).catch(onError)
    },
    onError,
  )
}

export async function signOutFirebase(
  services: FirebaseServices = getFirebaseServices(),
): Promise<void> {
  try {
    await signOut(services.auth)
  } finally {
    clearSensitiveBrowserState()
  }
}
