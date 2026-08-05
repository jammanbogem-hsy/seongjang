import { randomInt } from 'node:crypto'
import { Timestamp } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import {
  bootstrapOwnerEmail,
  EVENT_ID,
  FUNCTION_COST_GUARDRAILS,
  JOIN_ACCESS_SUBJECT,
  MAX_PARTICIPANTS,
  participantSecretKey,
  PIN_RUNTIME_SERVICE_ACCOUNT,
  PUBLIC_SLUG,
  REGION,
} from './lib/config.js'
import { db } from './lib/firebase.js'
import { createPinVerifier, encryptPin } from './lib/pin-crypto.js'
import { normalizeEmail } from './lib/validation.js'
import { EVENT_SLIDES } from './event-template.js'

export interface SeedVibe26Options {
  email: string
  ownerUid: string
  secret: string
}

/** Creates an empty production event. It never creates sample people or content. */
export async function seedVibe26Data({
  email,
  ownerUid,
  secret,
}: SeedVibe26Options): Promise<{ created: boolean; eventId: string; participantCount: number }> {
  const markerRef = db.doc('systemMigrations/bootstrap-vibecoding-v3-clean')
  const eventRef = db.doc(`events/${EVENT_ID}`)
  const result = await db.runTransaction(async (transaction) => {
    const [marker, existingEvent] = await Promise.all([
      transaction.get(markerRef),
      transaction.get(eventRef),
    ])
    if (marker.exists || existingEvent.exists) {
      const recordedOwner = marker.exists ? marker.get('ownerUid') : existingEvent.get('ownerUid')
      if (recordedOwner !== ownerUid) {
        throw new HttpsError('already-exists', '초기 행사는 다른 소유자 계정으로 생성되었습니다.')
      }
      return {
        created: false,
        participantCount: Number(existingEvent.get('participantCount') ?? 0),
      }
    }

    const now = Timestamp.now()
    const joinAccessCode = String(randomInt(0, 1_000_000)).padStart(6, '0')
    const firstSlide = EVENT_SLIDES[0]!
    const cleanSlides = EVENT_SLIDES.map((slide) => ({
      ...slide,
      answersRevealed: false,
      commentsEnabled: false,
    }))

    transaction.create(eventRef, {
      schemaVersion: 3,
      code: 'VIBE26',
      codeNormalized: 'VIBE26',
      publicSlug: PUBLIC_SLUG,
      title: 'VibeCoding Hackathon 2026',
      tagline: '각자의 아이디어가 다음 행사의 출발점이 되는 하루',
      organizerName: 'VibeCoding 운영팀',
      eventDate: '2026-08-22',
      capacity: MAX_PARTICIPANTS,
      participantCount: 0,
      ownerUid,
      lifecycle: 'draft',
      publicationGeneration: 0,
      registrationOpen: true,
      encryptedJoinAccessCode: encryptPin(secret, EVENT_ID, JOIN_ACCESS_SUBJECT, joinAccessCode),
      joinAccessCodeVerifier: createPinVerifier(secret, EVENT_ID, JOIN_ACCESS_SUBJECT, joinAccessCode),
      joinAccessCodeRotatedAt: now,
      joinAccessCodeRotatedBy: ownerUid,
      exhibitionPublished: false,
      publishedRevision: 0,
      createdAt: now,
      updatedAt: now,
    })
    transaction.set(db.doc('roomCodes/VIBE26'), { eventId: EVENT_ID, createdAt: now })
    transaction.create(db.doc(`events/${EVENT_ID}/members/${ownerUid}`), {
      uid: ownerUid,
      email,
      role: 'owner',
      status: 'active',
      joinedAt: now,
    })
    transaction.create(db.doc(`users/${ownerUid}/memberships/${EVENT_ID}`), {
      eventId: EVENT_ID,
      eventTitle: 'VibeCoding Hackathon 2026',
      role: 'owner',
      status: 'active',
      joinedAt: now,
    })
    transaction.create(db.doc(`events/${EVENT_ID}/live/state`), {
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
      updatedBy: ownerUid,
    })

    for (const slide of cleanSlides) {
      transaction.create(db.doc(`events/${EVENT_ID}/slides/${slide.id}`), {
        ...slide,
        createdAt: now,
        updatedAt: now,
      })
    }

    transaction.create(db.doc(`events/${EVENT_ID}/synthesis/current`), {
      organizerSummary: '',
      nicknamePolicy: 'nickname',
      themeIds: [],
      highlightAnswerIds: [],
      revision: 0,
      updatedAt: now,
      updatedBy: ownerUid,
    })

    transaction.create(db.doc(`publicEvents/${PUBLIC_SLUG}`), {
      eventId: EVENT_ID,
      title: 'VibeCoding Hackathon 2026',
      tagline: '각자의 아이디어가 다음 행사의 출발점이 되는 하루',
      join: {
        participantCount: 0,
        room: {
          id: EVENT_ID,
          code: 'VIBE26',
          title: 'VibeCoding Hackathon 2026',
          tagline: '각자의 아이디어가 다음 행사의 출발점이 되는 하루',
          organizerName: 'VibeCoding 운영팀',
          eventDate: '2026-08-22',
          capacity: MAX_PARTICIPANTS,
        },
        slides: cleanSlides.map((slide) => ({
          id: slide.id,
          order: slide.order,
          eyebrow: slide.eyebrow,
          title: slide.title,
          prompt: slide.prompt,
          helper: slide.helper,
          durationSec: slide.durationSec,
          illustration: slide.illustration,
          answersRevealed: false,
          commentsEnabled: false,
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

    transaction.create(markerRef, {
      checksum: 'vibecoding-v3-clean-event',
      eventId: EVENT_ID,
      ownerUid,
      participantCount: 0,
      status: 'complete',
      completedAt: now,
    })
    return { created: true, participantCount: 0 }
  })

  return { eventId: EVENT_ID, ...result }
}

export const bootstrapVibe26 = onCall(
  {
    ...FUNCTION_COST_GUARDRAILS,
    region: REGION,
    enforceAppCheck: true,
    maxInstances: 1,
    serviceAccount: PIN_RUNTIME_SERVICE_ACCOUNT,
    secrets: [participantSecretKey],
    timeoutSeconds: 120,
  },
  async (request) => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Google 로그인이 필요합니다.')
    const provider = request.auth.token.firebase?.sign_in_provider
    const email = typeof request.auth.token.email === 'string'
      ? normalizeEmail(request.auth.token.email)
      : ''
    if (
      provider !== 'google.com'
      || request.auth.token.email_verified !== true
      || email !== normalizeEmail(bootstrapOwnerEmail.value())
    ) {
      throw new HttpsError('permission-denied', '초기 행사 소유자 계정을 확인할 수 없습니다.')
    }
    return seedVibe26Data({ email, ownerUid: request.auth.uid, secret: participantSecretKey.value() })
  },
)
