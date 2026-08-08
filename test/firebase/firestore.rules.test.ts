// @vitest-environment node

import { readFile } from 'node:fs/promises'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
} from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST
const runRulesTests = Boolean(emulatorHost)
const projectId = process.env.GCLOUD_PROJECT || 'demo-vibecoding-rules'
const eventId = 'event-vibe26'
const publicSlug = 'vibecoding-2026'
const participantA = 'participant-a'
const participantB = 'participant-b'
const ownerUid = 'owner-user'
const adminUid = 'admin-user'

const googleOrganizerClaims = {
  email: 'organizer@gmail.com',
  email_verified: true,
  firebase: { sign_in_provider: 'google.com' },
}

function emulatorAddress(): { host: string; port: number } {
  const [host = '127.0.0.1', rawPort = '8080'] = (emulatorHost ?? '127.0.0.1:8080').split(':')
  return { host, port: Number(rawPort) }
}

function member(role: 'admin' | 'owner' | 'participant', uid: string) {
  return {
    role,
    status: 'active',
    uid,
  }
}

function answerDraft(ownerParticipantId: string, slideId = 'stage-discover', revision = 1) {
  return {
    clientMutationId: `answer-${ownerParticipantId}-${slideId}`,
    clientUpdatedAt: '2026-08-05T02:00:00.000Z',
    content: `${ownerParticipantId} answer`,
    deviceId: 'rules-test-device',
    ownerParticipantId,
    revision,
    slideId,
    updatedAt: serverTimestamp(),
  }
}

function projectDraft(ownerParticipantId: string) {
  return {
    clientMutationId: `project-${ownerParticipantId}`,
    clientUpdatedAt: '2026-08-05T02:00:00.000Z',
    coverImage: '/assets/illustrations/cat-submission.webp',
    demoUrl: '',
    description: 'Private draft description',
    deviceId: 'rules-test-device',
    githubUrl: '',
    ownerParticipantId,
    pitch: 'Private draft pitch',
    retrospective: 'Private draft retrospective',
    revision: 1,
    tags: ['rules'],
    title: `${ownerParticipantId} project`,
    updatedAt: serverTimestamp(),
  }
}

function privateComposerDraft(targetType = 'comment') {
  return {
    clientMutationId: 'private-composer-test',
    clientUpdatedAt: '2026-08-05T02:00:00.000Z',
    deviceId: 'rules-test-device',
    payload: { body: '등록 전의 비공개 검토 의견', field: '상세 설명' },
    targetId: 'answer-revealed',
    targetType,
    updatedAt: serverTimestamp(),
  }
}

describe.skipIf(!runRulesTests)('Firestore security rules', () => {
  let testEnvironment: RulesTestEnvironment

  beforeAll(async () => {
    const rules = await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8')
    testEnvironment = await initializeTestEnvironment({
      projectId,
      firestore: {
        ...emulatorAddress(),
        rules,
      },
    })
  })

  beforeEach(async () => {
    await testEnvironment.clearFirestore()
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      await Promise.all([
        setDoc(doc(db, `events/${eventId}`), {
          lifecycle: 'live',
          ownerUid,
          publicSlug,
          title: 'VibeCoding Hackathon',
        }),
        setDoc(doc(db, `events/${eventId}/live/state`), {
          activeSlideId: 'stage-discover',
          endsAt: null,
          revision: 1,
          sessionStatus: 'live',
          timerStatus: 'idle',
        }),
        setDoc(doc(db, `events/${eventId}/slides/stage-discover`), {
          answersRevealed: false,
          title: 'Discover',
        }),
        setDoc(doc(db, `events/${eventId}/members/${participantA}`), member('participant', participantA)),
        setDoc(doc(db, `events/${eventId}/members/${participantB}`), member('participant', participantB)),
        setDoc(doc(db, `events/${eventId}/members/${ownerUid}`), member('owner', ownerUid)),
        setDoc(doc(db, `events/${eventId}/members/${adminUid}`), member('admin', adminUid)),
        setDoc(doc(db, `events/${eventId}/participants/${participantA}`), {
          nickname: 'Alpha',
          uid: participantA,
        }),
        setDoc(doc(db, `events/${eventId}/participants/${participantB}`), {
          nickname: 'Beta',
          uid: participantB,
        }),
        setDoc(doc(db, `events/${eventId}/answerDrafts/${participantB}__stage-discover`), answerDraft(participantB)),
        setDoc(doc(db, `events/${eventId}/answers/answer-revealed`), {
          ownerParticipantId: participantB,
          slideId: 'stage-discover',
          status: 'submitted',
          visibility: 'revealed',
        }),
        setDoc(doc(db, `events/${eventId}/projectDrafts/${participantB}`), projectDraft(participantB)),
        setDoc(doc(db, `events/${eventId}/members/${participantB}/drafts/comment__answer-revealed`), privateComposerDraft()),
        setDoc(doc(db, `events/${eventId}/discussionComments/comment-event`), {
          answerId: 'answer-revealed',
          body: '공개 댓글',
          visibility: 'event',
        }),
        setDoc(doc(db, `events/${eventId}/discussionComments/comment-private`), {
          answerId: 'answer-private',
          body: '비공개 댓글',
          visibility: 'private',
        }),
        setDoc(doc(db, `events/${eventId}/adminInvites/invite-1`), {
          email: 'admin@example.com',
          role: 'admin',
        }),
        setDoc(doc(db, `events/${eventId}/themes/theme-private`), {
          label: '주최자 정리 주제',
        }),
        setDoc(doc(db, `events/${eventId}/synthesis/current`), {
          organizerSummary: '발행 전 주최자 정리 초안',
        }),
        setDoc(doc(db, `participantSecrets/${eventId}/members/${participantA}`), {
          encryptedPin: { ciphertext: 'private' },
          pinVerifier: 'private',
        }),
        setDoc(doc(db, `publicEvents/${publicSlug}`), {
          exhibitionPublished: true,
          eventId,
          latestRevision: 2,
          published: true,
          title: 'Published VibeCoding event',
        }),
        setDoc(doc(db, `publicEvents/${publicSlug}/revisions/1`), {
          revision: 1,
          status: 'published',
        }),
        setDoc(doc(db, `publicEvents/${publicSlug}/revisions/2`), {
          exhibitionPublished: true,
          revision: 2,
          status: 'published',
        }),
        setDoc(doc(db, `publicEvents/${publicSlug}/revisions/1/answers/old-answer`), {
          content: 'stale public answer',
        }),
        setDoc(doc(db, `publicEvents/${publicSlug}/revisions/2/answers/current-answer`), {
          content: 'current public answer',
        }),
        setDoc(doc(db, `publicEvents/${publicSlug}/revisions/2/projects/current-project`), {
          title: 'current public project',
        }),
      ])
    })
  })

  afterAll(async () => {
    await testEnvironment?.cleanup()
  })

  it('limits anonymous users to the public event projection', async () => {
    const db = testEnvironment.unauthenticatedContext().firestore()

    const publicSnapshot = await assertSucceeds(getDoc(doc(db, `publicEvents/${publicSlug}`)))
    expect(publicSnapshot.data()?.title).toBe('Published VibeCoding event')
    await assertFails(getDoc(doc(db, `events/${eventId}`)))
    await assertFails(getDoc(doc(db, `events/${eventId}/live/state`)))
    await assertFails(setDoc(doc(db, `publicEvents/${publicSlug}`), { published: false }))
  })

  it('exposes only the latest public revision and revokes exhibition projects immediately', async () => {
    const db = testEnvironment.unauthenticatedContext().firestore()

    await assertFails(getDoc(doc(db, `publicEvents/${publicSlug}/revisions/1`)))
    await assertFails(getDoc(doc(db, `publicEvents/${publicSlug}/revisions/1/answers/old-answer`)))
    await assertSucceeds(getDoc(doc(db, `publicEvents/${publicSlug}/revisions/2`)))
    await assertSucceeds(getDoc(doc(db, `publicEvents/${publicSlug}/revisions/2/answers/current-answer`)))
    await assertSucceeds(getDoc(doc(db, `publicEvents/${publicSlug}/revisions/2/projects/current-project`)))
    await assertSucceeds(getDocs(collection(db, `publicEvents/${publicSlug}/revisions/2/answers`)))
    await assertSucceeds(getDocs(collection(db, `publicEvents/${publicSlug}/revisions/2/projects`)))

    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), `publicEvents/${publicSlug}`),
        { exhibitionPublished: false },
        { merge: true },
      )
    })
    await assertSucceeds(getDoc(doc(db, `publicEvents/${publicSlug}/revisions/2/answers/current-answer`)))
    await assertFails(getDoc(doc(db, `publicEvents/${publicSlug}/revisions/2/projects/current-project`)))
    await assertFails(getDocs(collection(db, `publicEvents/${publicSlug}/revisions/2/projects`)))
  })

  it('allows participant A to create and read only their own answer draft', async () => {
    const db = testEnvironment.authenticatedContext(participantA).firestore()
    const ownDraft = doc(db, `events/${eventId}/answerDrafts/${participantA}__stage-discover`)

    await assertSucceeds(setDoc(ownDraft, answerDraft(participantA)))
    const snapshot = await assertSucceeds(getDoc(ownDraft))
    expect(snapshot.data()?.ownerParticipantId).toBe(participantA)
  })

  it('continues accepting answer drafts after the organizer reveals the active responses', async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), `events/${eventId}/slides/stage-discover`),
        { answersRevealed: true },
        { merge: true },
      )
    })
    const db = testEnvironment.authenticatedContext(participantA).firestore()

    await assertSucceeds(setDoc(
      doc(db, `events/${eventId}/answerDrafts/${participantA}__stage-discover`),
      answerDraft(participantA),
    ))
  })

  it('keeps a short autosave grace window after the organizer advances the slide', async () => {
    const db = testEnvironment.authenticatedContext(participantA).firestore()
    const ownDraft = doc(db, `events/${eventId}/answerDrafts/${participantA}__stage-discover`)
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), `events/${eventId}/live/state`), {
        activeSlideId: 'stage-build',
        draftGraceUntil: Timestamp.fromMillis(Date.now() + 30_000),
        endsAt: null,
        previousSlideId: 'stage-discover',
        revision: 2,
        sessionStatus: 'live',
        timerStatus: 'idle',
      })
    })

    await assertSucceeds(setDoc(ownDraft, answerDraft(participantA)))

    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), `events/${eventId}/live/state`), {
        draftGraceUntil: Timestamp.fromMillis(Date.now() - 1_000),
      }, { merge: true })
    })
    await assertFails(setDoc(ownDraft, answerDraft(participantA, 'stage-discover', 2)))
  })

  it('rejects answer drafts until the organizer starts the session', async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      await Promise.all([
        setDoc(doc(db, `events/${eventId}`), { lifecycle: 'lobby' }, { merge: true }),
        setDoc(doc(db, `events/${eventId}/live/state`), { sessionStatus: 'lobby' }, { merge: true }),
      ])
    })
    const db = testEnvironment.authenticatedContext(participantA).firestore()
    await assertFails(setDoc(
      doc(db, `events/${eventId}/answerDrafts/${participantA}__stage-discover`),
      answerDraft(participantA),
    ))
  })

  it('allows participant A to create and read only their own project draft', async () => {
    const db = testEnvironment.authenticatedContext(participantA).firestore()
    const ownDraft = doc(db, `events/${eventId}/projectDrafts/${participantA}`)

    await assertSucceeds(setDoc(ownDraft, projectDraft(participantA)))
    const snapshot = await assertSucceeds(getDoc(ownDraft))
    expect(snapshot.data()?.ownerParticipantId).toBe(participantA)
  })

  it('rejects stale answer and project draft revisions from another device', async () => {
    const db = testEnvironment.authenticatedContext(participantA).firestore()
    const answerRef = doc(db, `events/${eventId}/answerDrafts/${participantA}__stage-discover`)
    const projectRef = doc(db, `events/${eventId}/projectDrafts/${participantA}`)

    await assertSucceeds(setDoc(answerRef, answerDraft(participantA)))
    await assertSucceeds(setDoc(projectRef, projectDraft(participantA)))
    await assertSucceeds(setDoc(answerRef, answerDraft(participantA, 'stage-discover', 2)))
    await assertFails(setDoc(answerRef, answerDraft(participantA, 'stage-discover', 2)))

    await assertSucceeds(setDoc(projectRef, { ...projectDraft(participantA), revision: 2 }))
    await assertFails(setDoc(projectRef, { ...projectDraft(participantA), revision: 2 }))
  })

  it('denies participant A access to participant B drafts', async () => {
    const db = testEnvironment.authenticatedContext(participantA).firestore()

    await assertFails(getDoc(doc(db, `events/${eventId}/answerDrafts/${participantB}__stage-discover`)))
    await assertFails(setDoc(
      doc(db, `events/${eventId}/answerDrafts/${participantB}__stage-discover`),
      answerDraft(participantB),
    ))
    await assertFails(getDoc(doc(db, `events/${eventId}/projectDrafts/${participantB}`)))
    await assertFails(setDoc(doc(db, `events/${eventId}/projectDrafts/${participantB}`), projectDraft(participantB)))
  })

  it('autosaves private composers only under the signed-in member', async () => {
    const db = testEnvironment.authenticatedContext(participantA).firestore()
    const ownDraft = doc(db, `events/${eventId}/members/${participantA}/drafts/comment__answer-revealed`)
    const otherDraft = doc(db, `events/${eventId}/members/${participantB}/drafts/comment__answer-revealed`)

    await assertSucceeds(setDoc(ownDraft, privateComposerDraft()))
    await assertSucceeds(getDoc(ownDraft))
    await assertFails(setDoc(otherDraft, privateComposerDraft()))
    await assertFails(setDoc(
      doc(db, `events/${eventId}/members/${participantA}/drafts/arbitrary-document-id`),
      privateComposerDraft(),
    ))
    await assertFails(setDoc(ownDraft, privateComposerDraft('unsupported-target')))
  })

  it('keeps unsent member composer drafts private from organizers', async () => {
    const ownerDb = testEnvironment.authenticatedContext(ownerUid, googleOrganizerClaims).firestore()
    const adminDb = testEnvironment.authenticatedContext(adminUid, googleOrganizerClaims).firestore()
    const privateDraftPath = `events/${eventId}/members/${participantB}/drafts/comment__answer-revealed`

    await assertFails(getDoc(doc(ownerDb, privateDraftPath)))
    await assertFails(getDoc(doc(adminDb, privateDraftPath)))
  })

  it('allows only organizers to autosave review composers for existing targets', async () => {
    const ownerDb = testEnvironment.authenticatedContext(ownerUid, googleOrganizerClaims).firestore()
    const participantDb = testEnvironment.authenticatedContext(participantA).firestore()
    const draft = privateComposerDraft('review-composer')
    const ownerDraft = doc(ownerDb, `events/${eventId}/members/${ownerUid}/drafts/review-composer__answer-revealed`)
    const participantDraft = doc(participantDb, `events/${eventId}/members/${participantA}/drafts/review-composer__answer-revealed`)

    await assertSucceeds(setDoc(ownerDraft, draft))
    await assertFails(setDoc(participantDraft, draft))
  })

  it('allows the participant realtime query to return only event-visible comments', async () => {
    const db = testEnvironment.authenticatedContext(participantA).firestore()
    const visibleComments = query(
      collection(db, `events/${eventId}/discussionComments`),
      where('visibility', '==', 'event'),
    )

    const snapshot = await assertSucceeds(getDocs(visibleComments))
    expect(snapshot.docs.map((item) => item.id)).toEqual(['comment-event'])
    await assertFails(getDoc(doc(db, `events/${eventId}/discussionComments/comment-private`)))
  })

  it('denies participants access to secrets and organizer-only data', async () => {
    const db = testEnvironment.authenticatedContext(participantA).firestore()

    await assertFails(getDoc(doc(db, `participantSecrets/${eventId}/members/${participantA}`)))
    await assertFails(getDoc(doc(db, `events/${eventId}/members/${ownerUid}`)))
    await assertFails(getDoc(doc(db, `events/${eventId}/adminInvites/invite-1`)))
    await assertFails(getDoc(doc(db, `events/${eventId}/themes/theme-private`)))
    await assertFails(getDoc(doc(db, `events/${eventId}/synthesis/current`)))
    await assertFails(getDoc(doc(db, `events/${eventId}/participants/${participantB}`)))
  })

  it.each([
    ['owner', ownerUid],
    ['admin', adminUid],
  ])('allows an active %s member to read organizer data', async (_role, uid) => {
    const db = testEnvironment.authenticatedContext(uid, googleOrganizerClaims).firestore()

    await assertSucceeds(getDoc(doc(db, `events/${eventId}`)))
    await assertSucceeds(getDoc(doc(db, `events/${eventId}/live/state`)))
    await assertSucceeds(getDoc(doc(db, `events/${eventId}/participants/${participantA}`)))
    await assertSucceeds(getDoc(doc(db, `events/${eventId}/adminInvites/invite-1`)))
    await assertSucceeds(getDoc(doc(db, `events/${eventId}/themes/theme-private`)))
    await assertSucceeds(getDoc(doc(db, `events/${eventId}/synthesis/current`)))
    await assertSucceeds(getDoc(doc(db, `events/${eventId}/answerDrafts/${participantB}__stage-discover`)))
    await assertSucceeds(getDoc(doc(db, `events/${eventId}/projectDrafts/${participantB}`)))
  })

  it('keeps participant secrets inaccessible even to organizer clients', async () => {
    const ownerDb = testEnvironment.authenticatedContext(ownerUid, googleOrganizerClaims).firestore()
    const adminDb = testEnvironment.authenticatedContext(adminUid, googleOrganizerClaims).firestore()

    await assertFails(getDoc(doc(ownerDb, `participantSecrets/${eventId}/members/${participantA}`)))
    await assertFails(getDoc(doc(adminDb, `participantSecrets/${eventId}/members/${participantA}`)))
  })

  it('denies participant writes to organizer-controlled live state', async () => {
    const db = testEnvironment.authenticatedContext(participantA).firestore()

    await assertFails(setDoc(doc(db, `events/${eventId}/live/state`), {
      activeSlideId: 'stage-build',
      revision: 2,
    }))
  })

  it('shares live reactions and chat with active members but keeps writes server-only', async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      await Promise.all([
        setDoc(doc(db, `events/${eventId}/liveReactions/stage-discover__${participantA}`), {
          kind: 'like',
          participantId: participantA,
          slideId: 'stage-discover',
          updatedAt: Timestamp.now(),
        }),
        setDoc(doc(db, `events/${eventId}/liveChatMessages/message-a`), {
          body: '질문이 있어요',
          createdAt: Timestamp.now(),
          participantId: participantA,
          slideId: 'stage-discover',
        }),
      ])
    })

    const participantDb = testEnvironment.authenticatedContext(participantB).firestore()
    const anonymousDb = testEnvironment.unauthenticatedContext().firestore()
    await assertSucceeds(getDocs(collection(participantDb, `events/${eventId}/liveReactions`)))
    await assertSucceeds(getDocs(collection(participantDb, `events/${eventId}/liveChatMessages`)))
    await assertFails(getDocs(collection(anonymousDb, `events/${eventId}/liveChatMessages`)))
    await assertFails(setDoc(
      doc(participantDb, `events/${eventId}/liveChatMessages/direct-write`),
      { body: '우회 쓰기', participantId: participantB, slideId: 'stage-discover' },
    ))
  })

  it('denies organizer-only data to an active member signed in without Google', async () => {
    const db = testEnvironment.authenticatedContext(adminUid, {
      email: 'admin@gmail.com',
      email_verified: true,
      firebase: { sign_in_provider: 'password' },
    }).firestore()

    await assertSucceeds(getDoc(doc(db, `events/${eventId}`)))
    await assertFails(getDoc(doc(db, `events/${eventId}/participants/${participantA}`)))
    await assertFails(getDoc(doc(db, `events/${eventId}/adminInvites/invite-1`)))
  })
})
