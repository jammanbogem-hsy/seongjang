import type { CallableRequest } from 'firebase-functions/v2/https'
import { HttpsError } from 'firebase-functions/v2/https'
import { db } from './firebase.js'

export interface EventActor {
  email: string | null
  role: 'admin' | 'owner' | 'participant'
  uid: string
}

type CallableAuth = CallableRequest<unknown>['auth']

export function requireSignedIn(auth: CallableAuth): NonNullable<CallableAuth> {
  if (!auth?.uid) throw new HttpsError('unauthenticated', '로그인이 필요합니다.')
  return auth
}

export function isVerifiedGoogleIdentity(token: Record<string, unknown>): boolean {
  const firebaseClaim = token.firebase
  return token.email_verified === true
    && typeof token.email === 'string'
    && typeof firebaseClaim === 'object'
    && firebaseClaim !== null
    && (firebaseClaim as Record<string, unknown>).sign_in_provider === 'google.com'
}

export async function requireEventActor(
  eventId: string,
  auth: CallableAuth,
): Promise<EventActor> {
  const signedIn = requireSignedIn(auth)
  const membership = await db.doc(`events/${eventId}/members/${signedIn.uid}`).get()
  if (!membership.exists || membership.get('status') !== 'active') {
    throw new HttpsError('permission-denied', '이 행사에 접근할 권한이 없습니다.')
  }
  const role = membership.get('role')
  if (role !== 'owner' && role !== 'admin' && role !== 'participant') {
    throw new HttpsError('permission-denied', '행사 역할을 확인할 수 없습니다.')
  }
  return {
    email: typeof signedIn.token.email === 'string' ? signedIn.token.email.toLowerCase() : null,
    role,
    uid: signedIn.uid,
  }
}

export async function requireOrganizer(
  eventId: string,
  auth: CallableAuth,
): Promise<EventActor & { role: 'admin' | 'owner' }> {
  const actor = await requireEventActor(eventId, auth)
  if (actor.role !== 'owner' && actor.role !== 'admin') {
    throw new HttpsError('permission-denied', '주최자 권한이 필요합니다.')
  }
  if (!auth || !isVerifiedGoogleIdentity(auth.token)) {
    throw new HttpsError('permission-denied', '인증된 Google 계정으로 다시 로그인해야 주최자 기능을 사용할 수 있습니다.')
  }
  return actor as EventActor & { role: 'admin' | 'owner' }
}

export async function requireOwner(
  eventId: string,
  auth: CallableAuth,
): Promise<EventActor & { role: 'owner' }> {
  const actor = await requireOrganizer(eventId, auth)
  if (actor.role !== 'owner') {
    throw new HttpsError('permission-denied', '행사 Owner 권한이 필요합니다.')
  }
  return actor as EventActor & { role: 'owner' }
}

export async function requireParticipant(
  eventId: string,
  auth: CallableAuth,
): Promise<EventActor & { role: 'participant' }> {
  const actor = await requireEventActor(eventId, auth)
  if (actor.role !== 'participant') {
    throw new HttpsError('permission-denied', '참여자 권한이 필요합니다.')
  }
  return actor as EventActor & { role: 'participant' }
}

export async function appendAuditLog(input: {
  action: string
  actor: EventActor
  eventId: string
  metadata?: Record<string, unknown>
  reason?: string
  result?: 'allowed' | 'denied'
  targetUid?: string
}): Promise<void> {
  const ref = db.collection(`events/${input.eventId}/auditLogs`).doc()
  const now = new Date()
  await ref.set({
    action: input.action,
    actorRole: input.actor.role,
    actorUid: input.actor.uid,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 180 * 24 * 60 * 60 * 1_000),
    metadata: input.metadata ?? {},
    reason: input.reason ?? null,
    result: input.result ?? 'allowed',
    targetUid: input.targetUid ?? null,
  })
}
