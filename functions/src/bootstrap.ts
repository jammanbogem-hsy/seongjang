import { randomInt } from 'node:crypto'
import { Timestamp } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import {
  bootstrapOwnerEmail,
  EVENT_ID,
  FUNCTION_COST_GUARDRAILS,
  MAX_PARTICIPANTS,
  participantSecretKey,
  PUBLIC_SLUG,
  REGION,
} from './lib/config.js'
import { db } from './lib/firebase.js'
import { createPinVerifier, encryptPin } from './lib/pin-crypto.js'
import { nicknameIndexId, normalizeEmail, normalizeNickname } from './lib/validation.js'
import {
  ACCENTS,
  ANSWER_SEEDS,
  COMMENT_SEEDS,
  ORGANIZER_SUMMARY,
  PARTICIPANT_NAMES,
  REVIEW_SEEDS,
  SEED_SLIDES,
  SEED_TIME,
  SUBMISSION_SEEDS,
  THEME_SEEDS,
} from './seed-data.js'

function timestamp(value: string): Timestamp {
  return Timestamp.fromDate(new Date(value))
}

function participantUid(index: number): string {
  return `participant-${String(index + 1).padStart(2, '0')}`
}

function participantName(uid: string): string {
  const index = Number(uid.split('-').at(-1)) - 1
  return PARTICIPANT_NAMES[index] ?? '참여자'
}

function privateAnswerId(index: number): string {
  const [authorUid, slideId] = ANSWER_SEEDS[index]!
  return `${authorUid}__${slideId}`
}

function privateAnswerIdFromLegacy(legacyId: string): string {
  const index = Number(legacyId.split('-').at(-1)) - 1
  if (!Number.isInteger(index) || !ANSWER_SEEDS[index]) return legacyId
  return privateAnswerId(index)
}

function privateSubmissionIdFromLegacy(legacyId: string): string {
  const index = Number(legacyId.split('-').at(-1)) - 1
  return SUBMISSION_SEEDS[index]?.[0] ?? legacyId
}

export interface SeedVibe26Options {
  email: string
  ownerUid: string
  secret: string
}

/**
 * Creates the one curated event as entity documents in a single transaction.
 * Seed participant PINs are generated randomly during the call. They are never
 * returned or written in plaintext; an authorized organizer can reveal them
 * through revealParticipantPin and hand them to the corresponding participant.
 */
export async function seedVibe26Data({
  email,
  ownerUid,
  secret,
}: SeedVibe26Options): Promise<{ created: boolean; eventId: string; participantCount: number }> {
  const markerRef = db.doc('systemMigrations/bootstrap-vibecoding-v2')
  const seedParticipants = PARTICIPANT_NAMES.map((nickname, index) => ({
      accent: ACCENTS[index % ACCENTS.length]!,
      joinedAt: timestamp(new Date(Date.parse(SEED_TIME) + index * 83_000).toISOString()),
      lastSeenAt: timestamp(new Date(Date.parse(SEED_TIME) + index * 179_000).toISOString()),
      nickname,
      pin: String(randomInt(0, 10_000)).padStart(4, '0'),
      uid: participantUid(index),
    }))

  const result = await db.runTransaction(async (transaction) => {
      const marker = await transaction.get(markerRef)
      if (marker.exists) {
        if (marker.get('ownerUid') !== ownerUid) {
          throw new HttpsError('already-exists', '초기 행사는 다른 소유자 계정으로 생성되었습니다.')
        }
        return { created: false, participantCount: Number(marker.get('participantCount') ?? 0) }
      }

      const now = Timestamp.now()
      transaction.create(db.doc(`events/${EVENT_ID}`), {
        schemaVersion: 2,
        code: 'VIBE26',
        codeNormalized: 'VIBE26',
        publicSlug: PUBLIC_SLUG,
        title: 'VibeCoding Hackathon 2026',
        tagline: '각자의 아이디어가 다음 행사의 출발점이 되는 하루',
        organizerName: 'VibeCoding 운영팀',
        eventDate: '2026-08-22',
        capacity: MAX_PARTICIPANTS,
        participantCount: seedParticipants.length,
        ownerUid,
        lifecycle: 'live',
        publicationGeneration: 0,
        registrationOpen: true,
        exhibitionPublished: true,
        publishedRevision: 1,
        createdAt: timestamp(SEED_TIME),
        updatedAt: now,
      })
      transaction.create(db.doc('roomCodes/VIBE26'), { eventId: EVENT_ID, createdAt: now })
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
        activeSlideId: 'stage-build',
        activeSlideIndex: 2,
        startedAt: timestamp('2026-08-04T09:20:00.000Z'),
        sessionStatus: 'live',
        timerStatus: 'paused',
        durationSec: 1_080,
        remainingSec: 642,
        endsAt: null,
        revision: 1,
        updatedAt: now,
        updatedBy: ownerUid,
      })

      for (const slide of SEED_SLIDES) {
        transaction.create(db.doc(`events/${EVENT_ID}/slides/${slide.id}`), {
          ...slide,
          createdAt: timestamp(SEED_TIME),
          updatedAt: now,
        })
      }

      for (const participant of seedParticipants) {
        const { nickname, normalizedNickname } = normalizeNickname(participant.nickname)
        transaction.create(db.doc(`events/${EVENT_ID}/members/${participant.uid}`), {
          uid: participant.uid,
          role: 'participant',
          status: 'active',
          joinedAt: participant.joinedAt,
          lastSeenAt: participant.lastSeenAt,
        })
        transaction.create(db.doc(`events/${EVENT_ID}/participants/${participant.uid}`), {
          uid: participant.uid,
          nickname,
          normalizedNickname,
          accent: participant.accent,
          joinedAt: participant.joinedAt,
          lastSeenAt: participant.lastSeenAt,
          membershipStatus: 'active',
          submissionStatus: SUBMISSION_SEEDS.some(([uid]) => uid === participant.uid)
            ? 'submitted'
            : 'draft',
        })
        transaction.create(db.doc(`events/${EVENT_ID}/participantDirectory/${participant.uid}`), {
          uid: participant.uid,
          nickname,
          accent: participant.accent,
          joinedAt: participant.joinedAt,
        })
        transaction.create(db.doc(`events/${EVENT_ID}/nicknameIndex/${nicknameIndexId(EVENT_ID, normalizedNickname)}`), {
          participantUid: participant.uid,
          nickname,
          createdAt: participant.joinedAt,
        })
        transaction.create(db.doc(`users/${participant.uid}/memberships/${EVENT_ID}`), {
          eventId: EVENT_ID,
          eventTitle: 'VibeCoding Hackathon 2026',
          role: 'participant',
          status: 'active',
          joinedAt: participant.joinedAt,
        })
        transaction.create(db.doc(`participantSecrets/${EVENT_ID}/members/${participant.uid}`), {
          pinVerifier: createPinVerifier(secret, EVENT_ID, participant.uid, participant.pin),
          encryptedPin: encryptPin(secret, EVENT_ID, participant.uid, participant.pin),
          failedAttempts: 0,
          lockedUntil: null,
          createdAt: now,
          updatedAt: now,
          migratedAt: now,
        })
      }

      ANSWER_SEEDS.forEach(([authorUid, slideId, content], index) => {
        const id = privateAnswerId(index)
        const createdAt = timestamp(
          new Date(Date.parse(SEED_TIME) + (index + 1) * 240_000).toISOString(),
        )
        transaction.create(db.doc(`events/${EVENT_ID}/answers/${id}`), {
          id,
          authorUid,
          ownerParticipantId: authorUid,
          participantId: authorUid,
          authorName: participantName(authorUid),
          slideId,
          content,
          status: 'submitted',
          visibility: SEED_SLIDES.find((slide) => slide.id === slideId)?.answersRevealed
            ? 'revealed'
            : 'owner',
          createdAt,
          updatedAt: createdAt,
          submittedAt: createdAt,
        })
      })

      COMMENT_SEEDS.forEach(([id, authorUid, answerId, body, date]) => {
        transaction.create(db.doc(`events/${EVENT_ID}/discussionComments/${id}`), {
          id,
          authorUid,
          authorParticipantId: authorUid,
          participantId: authorUid,
          authorName: participantName(authorUid),
          answerId: privateAnswerIdFromLegacy(answerId),
          body,
          visibility: 'event',
          createdAt: timestamp(date),
          updatedAt: timestamp(date),
        })
      })

      SUBMISSION_SEEDS.forEach((seed, index) => {
        const [authorUid, title, pitch, description, demoUrl, githubUrl, tags, retrospective, coverImage] = seed
        const createdAt = timestamp(
          new Date(Date.parse(SEED_TIME) + (index + 1) * 1_100_000).toISOString(),
        )
        const data = {
          id: authorUid,
          authorUid,
          ownerParticipantId: authorUid,
          participantId: authorUid,
          authorName: participantName(authorUid),
          title,
          pitch,
          description,
          demoUrl,
          githubUrl,
          tags: [...tags],
          retrospective,
          coverImage,
          status: 'submitted',
          createdAt,
          updatedAt: createdAt,
          submittedAt: createdAt,
        }
        transaction.create(db.doc(`events/${EVENT_ID}/submissions/${authorUid}`), data)
        transaction.create(db.doc(`events/${EVENT_ID}/projectDrafts/${authorUid}`), {
          ownerParticipantId: authorUid,
          title,
          pitch,
          description,
          demoUrl,
          githubUrl,
          tags: [...tags],
          retrospective,
          deviceId: 'bootstrap-v2',
          clientMutationId: `bootstrap-project-${index + 1}`,
          clientUpdatedAt: createdAt.toDate().toISOString(),
          updatedAt: createdAt,
        })
      })

      for (const thread of REVIEW_SEEDS) {
        transaction.create(db.doc(`events/${EVENT_ID}/reviewThreads/${thread.id}`), {
          id: thread.id,
          targetType: thread.targetType,
          targetId: thread.targetType === 'answer'
            ? privateAnswerIdFromLegacy(thread.targetId)
            : privateSubmissionIdFromLegacy(thread.targetId),
          participantUid: thread.participantUid,
          ownerParticipantId: thread.participantUid,
          field: thread.field,
          quote: thread.quote,
          status: thread.status,
          createdBy: ownerUid,
          createdAt: timestamp(thread.createdAt),
          updatedAt: timestamp(thread.updatedAt),
          resolvedAt: thread.resolvedAt ? timestamp(thread.resolvedAt) : null,
        })
        for (const [id, authorRole, authorUid, body, date] of thread.messages) {
          transaction.create(db.doc(`events/${EVENT_ID}/reviewThreads/${thread.id}/messages/${id}`), {
            id,
            authorRole,
            authorUid: authorRole === 'organizer' ? ownerUid : authorUid,
            authorParticipantId: authorRole === 'participant' ? authorUid : null,
            participantId: authorRole === 'participant' ? authorUid : null,
            body,
            createdAt: timestamp(date),
            updatedAt: timestamp(date),
          })
        }
      }

      for (const [id, label, description, color, answerIds] of THEME_SEEDS) {
        transaction.create(db.doc(`events/${EVENT_ID}/themes/${id}`), {
          id,
          label,
          description,
          color,
          answerIds: answerIds.map(privateAnswerIdFromLegacy),
          createdAt: timestamp(SEED_TIME),
          updatedAt: now,
        })
      }
      transaction.create(db.doc(`events/${EVENT_ID}/synthesis/current`), {
        organizerSummary: ORGANIZER_SUMMARY,
        nicknamePolicy: 'nickname',
        themeIds: THEME_SEEDS.map(([id]) => id),
        highlightAnswerIds: ['answer-01', 'answer-11', 'answer-12', 'answer-14']
          .map(privateAnswerIdFromLegacy),
        revision: 1,
        updatedAt: timestamp('2026-08-04T12:10:00.000Z'),
        updatedBy: ownerUid,
      })
      transaction.create(db.doc(`events/${EVENT_ID}/adminInvites/admin-invite-01`), {
        email: 'facilitator@vibecoding.kr',
        emailLower: 'facilitator@vibecoding.kr',
        role: 'admin',
        status: 'pending',
        invitedBy: ownerUid,
        invitedAt: timestamp('2026-08-03T08:30:00.000Z'),
        migrationNote: '기존 데모 초대는 실제 Auth 계정과 다시 연결해야 합니다.',
      })

      const publicRootRef = db.doc(`publicEvents/${PUBLIC_SLUG}`)
      const revisionRef = db.doc(`publicEvents/${PUBLIC_SLUG}/revisions/1`)
      transaction.create(publicRootRef, {
        eventId: EVENT_ID,
        title: 'VibeCoding Hackathon 2026',
        tagline: '각자의 아이디어가 다음 행사의 출발점이 되는 하루',
        join: {
          room: {
            id: EVENT_ID,
            code: 'VIBE26',
            title: 'VibeCoding Hackathon 2026',
            tagline: '각자의 아이디어가 다음 행사의 출발점이 되는 하루',
            organizerName: 'VibeCoding 운영팀',
            eventDate: '2026-08-22',
            capacity: MAX_PARTICIPANTS,
          },
          slides: SEED_SLIDES.map((slide) => ({
            id: slide.id,
            order: slide.order,
            eyebrow: slide.eyebrow,
            title: slide.title,
            prompt: slide.prompt,
            helper: slide.helper,
            durationSec: slide.durationSec,
            illustration: slide.illustration,
            answersRevealed: slide.answersRevealed,
            commentsEnabled: slide.commentsEnabled,
          })),
          live: {
            activeSlideId: 'stage-build',
            activeSlideIndex: 2,
            startedAt: timestamp('2026-08-04T09:20:00.000Z'),
            sessionStatus: 'live',
            timerStatus: 'paused',
            durationSec: 1_080,
            remainingSec: 642,
            endsAt: null,
            revision: 1,
            updatedAt: now,
          },
          updatedAt: now,
        },
        latestRevision: 1,
        revisionSequence: 1,
        published: true,
        exhibitionPublished: true,
        updatedAt: timestamp('2026-08-04T12:30:00.000Z'),
      })
      transaction.create(revisionRef, {
        revision: 1,
        status: 'published',
        title: 'VibeCoding Hackathon 2026',
        tagline: '각자의 아이디어가 다음 행사의 출발점이 되는 하루',
        organizerName: 'VibeCoding 운영팀',
        eventDate: '2026-08-22',
        summary: ORGANIZER_SUMMARY,
        nicknamePolicy: 'nickname',
        exhibitionPublished: true,
        highlightAnswerKeys: ['answer-01', 'answer-11', 'answer-12', 'answer-14'],
        metrics: {
          participantCount: 24,
          submittedAnswerCount: ANSWER_SEEDS.length,
          commentCount: COMMENT_SEEDS.length,
          projectCount: SUBMISSION_SEEDS.length,
          completionRate: 75,
        },
        publishedAt: timestamp('2026-08-04T12:30:00.000Z'),
      })
      for (const slide of SEED_SLIDES) {
        transaction.create(db.doc(`publicEvents/${PUBLIC_SLUG}/revisions/1/stages/${slide.id}`), {
          id: slide.id,
          order: slide.order,
          eyebrow: slide.eyebrow,
          title: slide.title,
          prompt: slide.prompt,
        })
      }
      ANSWER_SEEDS.forEach(([authorUid, slideId, content], index) => {
        const id = `answer-${String(index + 1).padStart(2, '0')}`
        transaction.create(db.doc(`publicEvents/${PUBLIC_SLUG}/revisions/1/answers/${id}`), {
          id,
          slideId,
          authorName: participantName(authorUid),
          content,
          submittedAt: timestamp(
            new Date(Date.parse(SEED_TIME) + (index + 1) * 240_000).toISOString(),
          ),
        })
      })
      COMMENT_SEEDS.forEach(([id, authorUid, answerId, body, date]) => {
        transaction.create(db.doc(`publicEvents/${PUBLIC_SLUG}/revisions/1/comments/${id}`), {
          id,
          answerId,
          authorName: participantName(authorUid),
          body,
          createdAt: timestamp(date),
        })
      })
      SUBMISSION_SEEDS.forEach((seed, index) => {
        const [authorUid, title, pitch, description, demoUrl, githubUrl, tags, retrospective, coverImage] = seed
        const id = `project-${String(index + 1).padStart(2, '0')}`
        transaction.create(db.doc(`publicEvents/${PUBLIC_SLUG}/revisions/1/projects/${id}`), {
          id,
          authorName: participantName(authorUid),
          title,
          pitch,
          description,
          demoUrl,
          githubUrl,
          tags: [...tags],
          retrospective,
          coverImage,
        })
      })
      for (const [id, label, description, color, answerIds] of THEME_SEEDS) {
        transaction.create(db.doc(`publicEvents/${PUBLIC_SLUG}/revisions/1/themes/${id}`), {
          id,
          label,
          description,
          color,
          answerCount: answerIds.length,
          excerpts: answerIds.slice(0, 3).map((answerId) => {
            const index = Number(answerId.split('-').at(-1)) - 1
            return ANSWER_SEEDS[index]?.[2] ?? ''
          }),
        })
      }

      transaction.create(markerRef, {
        checksum: 'vibecoding-v2-curated-entities-r1',
        eventId: EVENT_ID,
        ownerUid,
        participantCount: seedParticipants.length,
        status: 'complete',
        completedAt: now,
      })
      return { created: true, participantCount: seedParticipants.length }
  })

  return { eventId: EVENT_ID, ...result }
}

export const bootstrapVibe26 = onCall(
  {
    ...FUNCTION_COST_GUARDRAILS,
    region: REGION,
    enforceAppCheck: true,
    maxInstances: 1,
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
      provider !== 'google.com' ||
      request.auth.token.email_verified !== true ||
      email !== normalizeEmail(bootstrapOwnerEmail.value())
    ) {
      throw new HttpsError('permission-denied', '초기 행사 소유자 계정을 확인할 수 없습니다.')
    }
    return seedVibe26Data({
      email,
      ownerUid: request.auth.uid,
      secret: participantSecretKey.value(),
    })
  },
)
