import { createHmac, randomUUID } from 'node:crypto'
import { Timestamp } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { appendAuditLog, requireOrganizer } from './lib/authz.js'
import {
  FUNCTION_COST_GUARDRAILS,
  MAX_PARTICIPANTS,
  PIN_RUNTIME_SERVICE_ACCOUNT,
  participantSecretKey,
  REGION,
} from './lib/config.js'
import { auth, db } from './lib/firebase.js'
import { invalidCredentialHitsActiveLock } from './lib/credential-lock.js'
import {
  decryptPin,
  encryptPin,
  type EncryptedPin,
  createPinVerifier,
  verifyPin,
} from './lib/pin-crypto.js'
import {
  asRecord,
  nicknameIndexId,
  normalizeNickname,
  normalizePin,
  normalizeRoomCode,
  requiredString,
  safeDocumentId,
} from './lib/validation.js'

const MAX_FAILED_ATTEMPTS = 5
const MAX_FAILED_ATTEMPTS_PER_IP = 20
const MAX_FAILED_ATTEMPTS_PER_TARGET = 40
const LOCKOUT_MS = 15 * 60 * 1_000
const JOIN_WINDOW_MS = 60 * 60 * 1_000
const MAX_JOIN_REQUESTS_PER_IP_WINDOW = 600
const MAX_NEW_PARTICIPANTS_PER_AUTH_IDENTITY = 2
const MAX_NEW_PARTICIPANTS_PER_DEVICE = 2
const MAX_NEW_PARTICIPANTS_PER_IP_WINDOW = 100
const PIN_REVEAL_WINDOW_MS = 5 * 60 * 1_000
const MAX_PIN_REVEALS_PER_WINDOW = 5

interface JoinTransactionResult {
  created: boolean
  eventId: string
  failure?: 'pin'
  locked: boolean
  nickname: string
  participantUid: string
  verified: boolean
}

async function consumeJoinRateLimit(ip: string, secret: string, now: Timestamp): Promise<void> {
  const windowNumber = Math.floor(now.toMillis() / JOIN_WINDOW_MS)
  const ipKey = createHmac('sha256', secret).update(ip || 'unknown').digest('hex').slice(0, 32)
  const ref = db.doc(`joinRateLimits/${windowNumber}__${ipKey}`)
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    const count = Number(snapshot.get('count') ?? 0)
    if (count >= MAX_JOIN_REQUESTS_PER_IP_WINDOW) {
      throw new HttpsError('resource-exhausted', '입장 요청이 너무 많습니다. 잠시 뒤 다시 시도해주세요.')
    }
    transaction.set(ref, {
      count: count + 1,
      expiresAt: Timestamp.fromMillis((windowNumber + 2) * JOIN_WINDOW_MS),
      updatedAt: now,
    }, { merge: true })
  })
}

function privateLimitId(secret: string, ...parts: string[]): string {
  return createHmac('sha256', secret).update(parts.join('\u0000')).digest('hex')
}

function requireRecentOrganizerAuth(request: Parameters<typeof requireOrganizer>[1]): void {
  const authTime = Number(request?.token.auth_time ?? 0) * 1_000
  if (!Number.isFinite(authTime) || Date.now() - authTime > 10 * 60 * 1_000) {
    throw new HttpsError('failed-precondition', '민감한 작업 전에 관리자 계정으로 다시 인증해주세요.')
  }
}

async function consumePinRevealRateLimit(
  eventId: string,
  actorUid: string,
  now: Timestamp,
): Promise<void> {
  const windowNumber = Math.floor(now.toMillis() / PIN_REVEAL_WINDOW_MS)
  const ref = db.doc(`participantPinRevealLimits/${eventId}__${actorUid}__${windowNumber}`)
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    const count = Number(snapshot.get('count') ?? 0)
    if (count >= MAX_PIN_REVEALS_PER_WINDOW) {
      throw new HttpsError('resource-exhausted', 'PIN은 5분에 최대 5명까지 확인할 수 있습니다.')
    }
    transaction.set(ref, {
      actorUid,
      count: count + 1,
      eventId,
      expiresAt: Timestamp.fromMillis((windowNumber + 2) * PIN_REVEAL_WINDOW_MS),
      updatedAt: now,
    }, { merge: true })
  })
}

export const joinOrReenterParticipant = onCall(
  {
    ...FUNCTION_COST_GUARDRAILS,
    region: REGION,
    enforceAppCheck: true,
    serviceAccount: PIN_RUNTIME_SERVICE_ACCOUNT,
    secrets: [participantSecretKey],
    timeoutSeconds: 30,
  },
  async (request) => {
    const input = asRecord(request.data)
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', '안전한 입장을 위해 Firebase 호출자 인증이 필요합니다.')
    }
    const callerIdentity = safeDocumentId(
      typeof request.auth.token.joinCallerUid === 'string'
        ? request.auth.token.joinCallerUid
        : request.auth.uid,
      '호출자 ID',
    )
    const roomCode = normalizeRoomCode(requiredString(input, 'roomCode', { max: 12 }))
    const deviceId = requiredString(input, 'deviceId', { min: 12, max: 180, label: '기기 식별자' })
    // Keep the legacy automatic mode temporarily compatible with a cached
    // client while all newly deployed clients send an explicit entry intent.
    const entryMode = input.entryMode === 'register' || input.entryMode === 'reenter'
      ? input.entryMode
      : 'auto'
    const pin = normalizePin(input.pin)
    const { nickname, normalizedNickname } = normalizeNickname(
      requiredString(input, 'nickname', { max: 64 }),
    )
    const secret = participantSecretKey.value()
    const now = Timestamp.now()
    const callerIp = request.rawRequest.ip ?? 'unknown'
    await consumeJoinRateLimit(callerIp, secret, now)

    const roomCodeRef = db.doc(`roomCodes/${roomCode}`)
    const roomCodeSnapshot = await roomCodeRef.get()
    if (!roomCodeSnapshot.exists) {
      throw new HttpsError('not-found', '방 코드 또는 닉네임과 개인 입장코드를 다시 확인해주세요.')
    }
    const eventId = safeDocumentId(String(roomCodeSnapshot.get('eventId')), '행사 ID')
    const eventRef = db.doc(`events/${eventId}`)
    const trustedCallerKey = privateLimitId(secret, eventId, callerIdentity)
    const deviceKey = privateLimitId(secret, eventId, deviceId)
    const ipKey = privateLimitId(secret, eventId, callerIp)
    const attemptRef = db.doc(`participantAttemptLimits/${privateLimitId(
      secret,
      eventId,
      normalizedNickname,
      callerIdentity,
    )}`)
    const ipAttemptRef = db.doc(`participantIpAttemptLimits/${privateLimitId(
      secret,
      eventId,
      normalizedNickname,
      callerIp,
    )}`)
    const targetAttemptRef = db.doc(`participantTargetAttemptLimits/${privateLimitId(
      secret,
      eventId,
      normalizedNickname,
    )}`)
    const registrationWindow = Math.floor(now.toMillis() / JOIN_WINDOW_MS)
    const registrationRef = db.doc(`joinRegistrationLimits/${registrationWindow}__${trustedCallerKey}`)
    const deviceRegistrationRef = db.doc(`joinDeviceRegistrationLimits/${registrationWindow}__${deviceKey}`)
    const ipRegistrationRef = db.doc(`joinIpRegistrationLimits/${registrationWindow}__${ipKey}`)
    const indexRef = db.doc(
      `events/${eventId}/nicknameIndex/${nicknameIndexId(eventId, normalizedNickname)}`,
    )

    const result = await db.runTransaction<JoinTransactionResult>(async (transaction) => {
      const [eventSnapshot, indexSnapshot] = await Promise.all([
        transaction.get(eventRef),
        transaction.get(indexRef),
      ])
      if (!eventSnapshot.exists) {
        throw new HttpsError('not-found', '행사를 찾을 수 없습니다.')
      }
      const lifecycle = eventSnapshot.get('lifecycle')
      if (!['lobby', 'live', 'paused', 'submission'].includes(lifecycle)) {
        throw new HttpsError('failed-precondition', '현재 참여자 입장이 열려 있지 않습니다.')
      }

      if (indexSnapshot.exists) {
        if (entryMode === 'register') {
          throw new HttpsError(
            'already-exists',
            '이미 사용 중인 닉네임입니다. 이전 참여자라면 ‘다시 입장’을 선택해주세요.',
          )
        }
        const participantUid = safeDocumentId(
          String(indexSnapshot.get('participantUid')),
          '참여자 ID',
        )
        const secretRef = db.doc(`participantSecrets/${eventId}/members/${participantUid}`)
        const [secretSnapshot, attemptSnapshot, ipAttemptSnapshot, targetAttemptSnapshot] = await Promise.all([
          transaction.get(secretRef),
          transaction.get(attemptRef),
          transaction.get(ipAttemptRef),
          transaction.get(targetAttemptRef),
        ])
        if (!secretSnapshot.exists) {
          throw new HttpsError('data-loss', '참여자 인증 정보를 확인할 수 없습니다.')
        }
        const lockedUntil = attemptSnapshot.get('lockedUntil')
        const ipLockedUntil = ipAttemptSnapshot.get('lockedUntil')
        const targetLockedUntil = targetAttemptSnapshot.get('lockedUntil')
        const verifier = String(secretSnapshot.get('pinVerifier') ?? '')
        const verified = verifyPin(secret, eventId, participantUid, pin, verifier)
        if (invalidCredentialHitsActiveLock(
          verified,
          now.toMillis(),
          lockedUntil instanceof Timestamp ? lockedUntil.toMillis() : null,
          ipLockedUntil instanceof Timestamp ? ipLockedUntil.toMillis() : null,
          targetLockedUntil instanceof Timestamp ? targetLockedUntil.toMillis() : null,
        )) {
          return {
            created: false,
            eventId,
            failure: 'pin',
            locked: true,
            nickname,
            participantUid,
            verified: false,
          }
        }
        if (!verified) {
          const failedAttempts = Number(attemptSnapshot.get('failedAttempts') ?? 0) + 1
          const ipFailedAttempts = Number(ipAttemptSnapshot.get('failedAttempts') ?? 0) + 1
          const targetFailedAttempts = Number(targetAttemptSnapshot.get('failedAttempts') ?? 0) + 1
          transaction.set(attemptRef, {
            failedAttempts,
            lastFailedAt: now,
            lockedUntil: failedAttempts >= MAX_FAILED_ATTEMPTS
              ? Timestamp.fromMillis(now.toMillis() + LOCKOUT_MS)
              : null,
            expiresAt: Timestamp.fromMillis(now.toMillis() + 2 * LOCKOUT_MS),
            updatedAt: now,
          }, { merge: true })
          transaction.set(ipAttemptRef, {
            failedAttempts: ipFailedAttempts,
            lastFailedAt: now,
            lockedUntil: ipFailedAttempts >= MAX_FAILED_ATTEMPTS_PER_IP
              ? Timestamp.fromMillis(now.toMillis() + LOCKOUT_MS)
              : null,
            expiresAt: Timestamp.fromMillis(now.toMillis() + 2 * LOCKOUT_MS),
            updatedAt: now,
          }, { merge: true })
          transaction.set(targetAttemptRef, {
            failedAttempts: targetFailedAttempts,
            lastFailedAt: now,
            lockedUntil: targetFailedAttempts >= MAX_FAILED_ATTEMPTS_PER_TARGET
              ? Timestamp.fromMillis(now.toMillis() + LOCKOUT_MS)
              : null,
            expiresAt: Timestamp.fromMillis(now.toMillis() + 2 * LOCKOUT_MS),
            updatedAt: now,
          }, { merge: true })
          return {
            created: false,
            eventId,
            failure: 'pin',
            locked: failedAttempts >= MAX_FAILED_ATTEMPTS
              || ipFailedAttempts >= MAX_FAILED_ATTEMPTS_PER_IP
              || targetFailedAttempts >= MAX_FAILED_ATTEMPTS_PER_TARGET,
            nickname,
            participantUid,
            verified: false,
          }
        }

        if (attemptSnapshot.exists) transaction.delete(attemptRef)
        if (targetAttemptSnapshot.exists) transaction.delete(targetAttemptRef)
        // A valid PIN may always re-enter even when a shared NAT/IP bucket is
        // throttled. Keep the shared bucket intact so one valid re-entry does
        // not reopen brute-force attempts for every caller on that network.
        transaction.set(
          db.doc(`events/${eventId}/participants/${participantUid}`),
          { lastSeenAt: now, status: 'online' },
          { merge: true },
        )
        transaction.set(
          db.doc(`events/${eventId}/participantDirectory/${participantUid}`),
          { lastSeenAt: now, status: 'online' },
          { merge: true },
        )
        transaction.set(
          db.doc(`events/${eventId}/members/${participantUid}`),
          { lastSeenAt: now, status: 'active' },
          { merge: true },
        )
        return {
          created: false,
          eventId,
          locked: false,
          nickname: String(indexSnapshot.get('nickname') ?? nickname),
          participantUid,
          verified: true,
        }
      }

      if (entryMode === 'reenter') {
        throw new HttpsError(
          'not-found',
          '이 세션에 등록된 닉네임을 찾지 못했습니다. 닉네임을 확인하거나 ‘처음 입장’을 선택해주세요.',
        )
      }

      const participantCount = Number(eventSnapshot.get('participantCount') ?? 0)
      if (eventSnapshot.get('registrationOpen') === false) {
        throw new HttpsError(
          'failed-precondition',
          '신규 참여자 입장이 마감되었습니다. 기존 닉네임과 개인 입장코드로는 다시 입장할 수 있습니다.',
        )
      }
      const configuredCapacity = Number(eventSnapshot.get('capacity') ?? MAX_PARTICIPANTS)
      const capacity = Math.min(MAX_PARTICIPANTS, Math.max(1, configuredCapacity))
      if (participantCount >= capacity) {
        throw new HttpsError('resource-exhausted', `이 방은 최대 ${capacity}명까지 참여할 수 있습니다.`)
      }
      const [
        registrationSnapshot,
        deviceRegistrationSnapshot,
        ipRegistrationSnapshot,
      ] = await Promise.all([
        transaction.get(registrationRef),
        transaction.get(deviceRegistrationRef),
        transaction.get(ipRegistrationRef),
      ])
      const registrationCount = Number(registrationSnapshot.get('count') ?? 0)
      const deviceRegistrationCount = Number(deviceRegistrationSnapshot.get('count') ?? 0)
      const ipRegistrationCount = Number(ipRegistrationSnapshot.get('count') ?? 0)
      if (registrationCount >= MAX_NEW_PARTICIPANTS_PER_AUTH_IDENTITY) {
        throw new HttpsError(
          'resource-exhausted',
          '이 인증 세션에서는 새 닉네임을 더 만들 수 없습니다. 기존 닉네임으로 재입장해주세요.',
        )
      }
      if (deviceRegistrationCount >= MAX_NEW_PARTICIPANTS_PER_DEVICE) {
        throw new HttpsError(
          'resource-exhausted',
          '이 기기에서는 새 닉네임을 더 만들 수 없습니다. 기존 닉네임으로 재입장해주세요.',
        )
      }
      if (ipRegistrationCount >= MAX_NEW_PARTICIPANTS_PER_IP_WINDOW) {
        throw new HttpsError('resource-exhausted', '현장 네트워크의 신규 입장 한도에 도달했습니다. 주최자에게 문의해주세요.')
      }
      const participantUid = randomUUID()
      const participantRef = db.doc(`events/${eventId}/participants/${participantUid}`)
      const memberRef = db.doc(`events/${eventId}/members/${participantUid}`)
      const directoryRef = db.doc(`events/${eventId}/participantDirectory/${participantUid}`)
      const userMembershipRef = db.doc(`users/${participantUid}/memberships/${eventId}`)
      const secretRef = db.doc(`participantSecrets/${eventId}/members/${participantUid}`)

      transaction.create(indexRef, {
        participantUid,
        nickname,
        createdAt: now,
      })
      transaction.create(memberRef, {
        uid: participantUid,
        role: 'participant',
        status: 'active',
        joinedAt: now,
        lastSeenAt: now,
      })
      transaction.create(participantRef, {
        uid: participantUid,
        nickname,
        normalizedNickname,
        accent: '#3157C8',
        joinedAt: now,
        lastSeenAt: now,
        status: 'online',
        membershipStatus: 'active',
        submissionStatus: 'draft',
      })
      transaction.create(directoryRef, {
        uid: participantUid,
        nickname,
        accent: '#3157C8',
        joinedAt: now,
        lastSeenAt: now,
        status: 'online',
      })
      transaction.create(userMembershipRef, {
        eventId,
        eventTitle: String(eventSnapshot.get('title') ?? ''),
        role: 'participant',
        status: 'active',
        joinedAt: now,
      })
      transaction.create(secretRef, {
        pinVerifier: createPinVerifier(secret, eventId, participantUid, pin),
        encryptedPin: encryptPin(secret, eventId, participantUid, pin),
        failedAttempts: 0,
        lockedUntil: null,
        createdAt: now,
        updatedAt: now,
      })
      transaction.update(eventRef, {
        participantCount: participantCount + 1,
        updatedAt: now,
      })
      const publicSlug = String(eventSnapshot.get('publicSlug') ?? '').trim()
      if (publicSlug) {
        transaction.set(db.doc(`publicEvents/${safeDocumentId(publicSlug, '공개 행사 ID')}`), {
          join: { participantCount: participantCount + 1 },
          updatedAt: now,
        }, { merge: true })
      }
      transaction.set(registrationRef, {
        count: registrationCount + 1,
        expiresAt: Timestamp.fromMillis((registrationWindow + 2) * JOIN_WINDOW_MS),
        updatedAt: now,
      }, { merge: true })
      transaction.set(ipRegistrationRef, {
        count: ipRegistrationCount + 1,
        expiresAt: Timestamp.fromMillis((registrationWindow + 2) * JOIN_WINDOW_MS),
        updatedAt: now,
      }, { merge: true })
      transaction.set(deviceRegistrationRef, {
        count: deviceRegistrationCount + 1,
        expiresAt: Timestamp.fromMillis((registrationWindow + 2) * JOIN_WINDOW_MS),
        updatedAt: now,
      }, { merge: true })

      return {
        created: true,
        eventId,
        locked: false,
        nickname,
        participantUid,
        verified: true,
      }
    })

    if (!result.verified) {
      if (result.locked) {
        throw new HttpsError('resource-exhausted', '입장 시도가 잠시 잠겼습니다. 15분 뒤 다시 시도해주세요.')
      }
      throw new HttpsError('unauthenticated', '방 코드, 닉네임 또는 개인 입장코드를 다시 확인해주세요.')
    }

    const token = await auth.createCustomToken(result.participantUid, {
      actorType: 'participant',
      eventId: result.eventId,
      joinCallerUid: callerIdentity,
    })
    return {
      customToken: token,
      eventId: result.eventId,
      notice: result.created
        ? '닉네임과 개인 입장코드가 등록되었습니다.'
        : '닉네임과 개인 입장코드를 확인했습니다. 이전 기록을 이어서 엽니다.',
      participant: {
        id: result.participantUid,
        nickname: result.nickname,
      },
      reentered: !result.created,
    }
  },
)

export const revealParticipantPin = onCall(
  {
    ...FUNCTION_COST_GUARDRAILS,
    region: REGION,
    enforceAppCheck: true,
    maxInstances: 5,
    serviceAccount: PIN_RUNTIME_SERVICE_ACCOUNT,
    secrets: [participantSecretKey],
    timeoutSeconds: 30,
  },
  async (request) => {
    const input = asRecord(request.data)
    const eventId = safeDocumentId(requiredString(input, 'eventId', { max: 128 }), '행사 ID')
    const participantUid = safeDocumentId(
      requiredString(input, 'participantUid', { max: 128 }),
      '참여자 ID',
    )
    const reason = requiredString(input, 'reason', {
      min: 2,
      max: 300,
      label: '조회 사유',
    })
    const actor = await requireOrganizer(eventId, request.auth)

    try {
      requireRecentOrganizerAuth(request.auth)
    } catch (error) {
      await appendAuditLog({
        action: 'participant.pin.reveal',
        actor,
        eventId,
        reason,
        result: 'denied',
        targetUid: participantUid,
        metadata: { cause: 'recent-auth-required' },
      })
      throw error
    }
    try {
      await consumePinRevealRateLimit(eventId, actor.uid, Timestamp.now())
    } catch (error) {
      await appendAuditLog({
        action: 'participant.pin.reveal',
        actor,
        eventId,
        reason,
        result: 'denied',
        targetUid: participantUid,
        metadata: { cause: 'rate-limit' },
      })
      throw error
    }

    const [participantSnapshot, secretSnapshot] = await Promise.all([
      db.doc(`events/${eventId}/participants/${participantUid}`).get(),
      db.doc(`participantSecrets/${eventId}/members/${participantUid}`).get(),
    ])
    if (!participantSnapshot.exists || !secretSnapshot.exists) {
      throw new HttpsError('not-found', '참여자 인증 정보를 찾을 수 없습니다.')
    }
    const encrypted = secretSnapshot.get('encryptedPin') as EncryptedPin | undefined
    if (!encrypted) throw new HttpsError('data-loss', '암호화된 PIN 정보를 확인할 수 없습니다.')

    let pin: string
    try {
      pin = decryptPin(participantSecretKey.value(), eventId, participantUid, encrypted)
    } catch {
      throw new HttpsError('data-loss', 'PIN 암호를 해독할 수 없습니다.')
    }

    await appendAuditLog({
      action: 'participant.pin.reveal',
      actor,
      eventId,
      reason,
      targetUid: participantUid,
      metadata: { expiresInSeconds: 30 },
    })
    return {
      expiresInSeconds: 30,
      participant: {
        id: participantUid,
        nickname: String(participantSnapshot.get('nickname') ?? ''),
      },
      pin,
    }
  },
)
