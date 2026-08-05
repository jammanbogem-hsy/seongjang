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
  if (auth?.token.email_verified !== true) {
    throw new HttpsError('permission-denied', '이메일 인증이 완료된 관리자 계정이 필요합니다.')
  }
  return actor as EventActor & { role: 'admin' | 'owner' }
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
  await ref.set({
    action: input.action,
    actorRole: input.actor.role,
    actorUid: input.actor.uid,
    createdAt: new Date(),
    metadata: input.metadata ?? {},
    reason: input.reason ?? null,
    result: input.result ?? 'allowed',
    targetUid: input.targetUid ?? null,
  })
}
