import { randomInt } from 'node:crypto'
import { Timestamp } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { EVENT_SLIDES } from './event-template.js'
import { isVerifiedGoogleIdentity, requireSignedIn } from './lib/authz.js'
import {
  bootstrapOwnerEmail,
  CORE_RUNTIME_SERVICE_ACCOUNT,
  FUNCTION_COST_GUARDRAILS,
  MAX_PARTICIPANTS,
  REGION,
} from './lib/config.js'
import { db } from './lib/firebase.js'
import { asRecord, normalizeEmail, optionalString, requiredString } from './lib/validation.js'

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function roomCode(): string {
  return Array.from({ length: 6 }, () => ROOM_ALPHABET[randomInt(0, ROOM_ALPHABET.length)]).join('')
}

export const createHackathonSession = onCall(
  {
    ...FUNCTION_COST_GUARDRAILS,
    region: REGION,
    enforceAppCheck: true,
    maxInstances: 3,
    serviceAccount: CORE_RUNTIME_SERVICE_ACCOUNT,
    timeoutSeconds: 60,
  },
  async (request) => {
    const signedIn = requireSignedIn(request.auth)
    if (!isVerifiedGoogleIdentity(signedIn.token)) {
      throw new HttpsError('permission-denied', '인증된 Google 계정으로 로그인해주세요.')
    }
    const email = normalizeEmail(String(signedIn.token.email ?? ''))
    if (email !== normalizeEmail(bootstrapOwnerEmail.value())) {
      throw new HttpsError('permission-denied', '새 세션은 플랫폼 Owner만 만들 수 있습니다.')
    }

    const input = asRecord(request.data)
    const title = requiredString(input, 'title', { min: 2, max: 80, label: '세션 이름' })
    const eventDate = requiredString(input, 'eventDate', { min: 10, max: 10, label: '진행 날짜' })
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
      throw new HttpsError('invalid-argument', '진행 날짜 형식을 확인해주세요.')
    }
    const tagline = optionalString(input, 'tagline', 160)
    const code = roomCode()
    const eventId = `session-${code.toLowerCase()}`
    const publicSlug = code.toLowerCase()
    const eventRef = db.doc(`events/${eventId}`)
    const roomCodeRef = db.doc(`roomCodes/${code}`)
    const publicRef = db.doc(`publicEvents/${publicSlug}`)
    const now = Timestamp.now()
    const firstSlide = {
      ...EVENT_SLIDES[0]!,
      id: 'slide-1',
      order: 1,
      eyebrow: 'PAGE 1 · 10분',
      title: '첫 질문을 입력하세요',
      prompt: '슬라이드 편집을 눌러 참여자에게 보낼 질문을 작성하세요.',
      helper: '참여자의 답변은 입력하는 동안 자동 저장됩니다.',
      durationSec: 600,
      answersRevealed: false,
      commentsEnabled: false,
    }
    const slides = [firstSlide]
    const organizerName = typeof signedIn.token.name === 'string'
      ? signedIn.token.name.slice(0, 80)
      : 'VibeCoding 운영팀'

    await db.runTransaction(async (transaction) => {
      const [existingCode, existingEvent] = await Promise.all([
        transaction.get(roomCodeRef),
        transaction.get(eventRef),
      ])
      if (existingCode.exists || existingEvent.exists) {
        throw new HttpsError('aborted', '방 코드 생성이 겹쳤습니다. 다시 시도해주세요.')
      }
      transaction.create(eventRef, {
        schemaVersion: 4,
        code,
        codeNormalized: code,
        publicSlug,
        title,
        tagline,
        organizerName,
        eventDate,
        capacity: MAX_PARTICIPANTS,
        participantCount: 0,
        ownerUid: signedIn.uid,
        lifecycle: 'lobby',
        publicationGeneration: 0,
        registrationOpen: true,
        exhibitionPublished: false,
        publishedRevision: 0,
        createdAt: now,
        updatedAt: now,
      })
      transaction.create(roomCodeRef, { eventId, publicSlug, createdAt: now })
      transaction.create(db.doc(`events/${eventId}/members/${signedIn.uid}`), {
        uid: signedIn.uid,
        email,
        role: 'owner',
        status: 'active',
        joinedAt: now,
      })
      transaction.create(db.doc(`users/${signedIn.uid}/memberships/${eventId}`), {
        eventId,
        eventTitle: title,
        roomCode: code,
        publicSlug,
        lifecycle: 'lobby',
        role: 'owner',
        status: 'active',
        joinedAt: now,
        updatedAt: now,
      })
      transaction.create(db.doc(`events/${eventId}/live/state`), {
        activeSlideId: firstSlide.id,
        activeSlideIndex: 0,
        startedAt: null,
        sessionStatus: 'lobby',
        timerStatus: 'idle',
        durationSec: firstSlide.durationSec,
        remainingSec: firstSlide.durationSec,
        endsAt: null,
        revision: 0,
        updatedAt: now,
        updatedBy: signedIn.uid,
      })
      slides.forEach((slide) => transaction.create(db.doc(`events/${eventId}/slides/${slide.id}`), {
        ...slide,
        createdAt: now,
        updatedAt: now,
        updatedBy: signedIn.uid,
      }))
      transaction.create(db.doc(`events/${eventId}/synthesis/current`), {
        organizerSummary: '',
        nicknamePolicy: 'nickname',
        themeIds: [],
        highlightAnswerIds: [],
        revision: 0,
        updatedAt: now,
        updatedBy: signedIn.uid,
      })
      transaction.create(publicRef, {
        eventId,
        title,
        tagline,
        join: {
          participantCount: 0,
          room: {
            id: eventId,
            code,
            title,
            tagline,
            organizerName,
            eventDate,
            capacity: MAX_PARTICIPANTS,
            lifecycle: 'lobby',
          },
          slides: slides.map(({ answersRevealed, commentsEnabled, ...slide }) => ({
            ...slide,
            answersRevealed,
            commentsEnabled,
          })),
          live: {
            activeSlideId: firstSlide.id,
            activeSlideIndex: 0,
            startedAt: null,
            sessionStatus: 'lobby',
            timerStatus: 'idle',
            durationSec: firstSlide.durationSec,
            remainingSec: firstSlide.durationSec,
            endsAt: null,
            revision: 0,
            updatedAt: now,
          },
          updatedAt: now,
        },
        latestRevision: 0,
        revisionSequence: 0,
        published: false,
        exhibitionPublished: false,
        updatedAt: now,
      })
    })

    return { eventId, publicSlug, roomCode: code, title }
  },
)
