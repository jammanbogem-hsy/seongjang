import { FieldValue, Firestore, Timestamp } from '@google-cloud/firestore'
import { OAuth2Client } from 'google-auth-library'

const EVENT_ID = 'room-vibe26'
const PUBLIC_SLUG = 'vibecoding-2026'
const OWNER_EMAIL = 'jammanbogem@gmail.com'
const EXPECTED_PROJECT_ID = 'vibecoding-a3ada'

function migrationAuthClient(): OAuth2Client | undefined {
  const activeAccountToken = process.env.VIBECODING_GCLOUD_ACCESS_TOKEN
  if (!activeAccountToken) return undefined
  const authClient = new OAuth2Client()
  authClient.setCredentials({ access_token: activeAccountToken })
  return authClient
}

const db = new Firestore({
  authClient: migrationAuthClient(),
  preferRest: true,
  projectId: EXPECTED_PROJECT_ID,
})

const CONTENT_COLLECTIONS = [
  'adminInvites',
  'answerDrafts',
  'answers',
  'auditLogs',
  'discussionComments',
  'nicknameIndex',
  'participantDirectory',
  'participants',
  'projectDrafts',
  'reviewCounters',
  'reviewThreads',
  'submissions',
  'themes',
] as const

async function main(): Promise<void> {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT
  if (projectId !== EXPECTED_PROJECT_ID) {
    throw new Error(`Refusing to run against project ${projectId ?? '(unset)'}. Expected ${EXPECTED_PROJECT_ID}.`)
  }

  const apply = process.argv.includes('--apply')
  const eventRef = db.doc(`events/${EVENT_ID}`)
  const event = await eventRef.get()
  if (!event.exists) throw new Error(`Event ${EVENT_ID} does not exist.`)

  const ownerUid = String(event.get('ownerUid') ?? '')
  if (!ownerUid) throw new Error('Event ownerUid is missing.')
  const ownerMember = await db.doc(`events/${EVENT_ID}/members/${ownerUid}`).get()
  const ownerEmail = String(ownerMember.get('email') ?? '').trim().toLowerCase()
  if (
    !ownerMember.exists
    || ownerMember.get('role') !== 'owner'
    || ownerMember.get('status') !== 'active'
    || ownerEmail !== OWNER_EMAIL
  ) {
    throw new Error('Owner safety check failed; no data was changed.')
  }

  const [members, slides, participantDocs, ...contentSnapshots] = await Promise.all([
    db.collection(`events/${EVENT_ID}/members`).get(),
    db.collection(`events/${EVENT_ID}/slides`).orderBy('order').get(),
    db.collection(`events/${EVENT_ID}/participants`).get(),
    ...CONTENT_COLLECTIONS.map((name) => db.collection(`events/${EVENT_ID}/${name}`).get()),
  ])
  if (slides.empty) throw new Error('Event slides are missing; no data was changed.')

  const counts = Object.fromEntries(
    CONTENT_COLLECTIONS.map((name, index) => [name, contentSnapshots[index]?.size ?? 0]),
  )
  const nonOwnerMembers = members.docs.filter((member) => member.id !== ownerUid)
  const removedUids = new Set([
    ...nonOwnerMembers.map((member) => member.id),
    ...participantDocs.docs.map((participant) => participant.id),
  ])
  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    eventId: EVENT_ID,
    preservedOwner: OWNER_EMAIL,
    nonOwnerMembers: nonOwnerMembers.length,
    contentDocuments: counts,
    slidesPreserved: slides.size,
  }, null, 2))
  if (!apply) return

  for (const name of CONTENT_COLLECTIONS) {
    await db.recursiveDelete(db.collection(`events/${EVENT_ID}/${name}`))
  }
  for (const member of nonOwnerMembers) {
    await db.recursiveDelete(member.ref)
  }
  for (const uid of removedUids) {
    await db.doc(`users/${uid}/memberships/${EVENT_ID}`).delete()
  }
  await db.recursiveDelete(db.collection(`participantSecrets/${EVENT_ID}/members`))
  await db.recursiveDelete(db.doc(`publicEvents/${PUBLIC_SLUG}`))

  const now = Timestamp.now()
  const firstSlide = slides.docs[0]!
  const room = {
    id: EVENT_ID,
    code: String(event.get('code') ?? 'VIBE26'),
    title: String(event.get('title') ?? 'VibeCoding Hackathon 2026'),
    tagline: String(event.get('tagline') ?? ''),
    organizerName: String(event.get('organizerName') ?? ''),
    eventDate: String(event.get('eventDate') ?? ''),
    capacity: Number(event.get('capacity') ?? 100),
  }
  const cleanSlides = slides.docs.map((slide) => {
    const data = slide.data()
    return {
      id: slide.id,
      order: Number(data.order ?? 0),
      eyebrow: String(data.eyebrow ?? ''),
      title: String(data.title ?? ''),
      prompt: String(data.prompt ?? ''),
      helper: String(data.helper ?? ''),
      durationSec: Number(data.durationSec ?? 0),
      illustration: String(data.illustration ?? ''),
      answersRevealed: false,
      commentsEnabled: false,
    }
  })
  const firstDuration = Number(firstSlide.get('durationSec') ?? 0)

  const batch = db.batch()
  batch.update(eventRef, {
    schemaVersion: 3,
    participantCount: 0,
    lifecycle: 'draft',
    publicationGeneration: 0,
    registrationOpen: true,
    exhibitionPublished: false,
    publishedRevision: 0,
    updatedAt: now,
  })
  for (const slide of slides.docs) {
    batch.update(slide.ref, { answersRevealed: false, commentsEnabled: false, updatedAt: now })
  }
  batch.set(db.doc(`events/${EVENT_ID}/live/state`), {
    activeSlideId: firstSlide.id,
    activeSlideIndex: 0,
    startedAt: null,
    sessionStatus: 'lobby',
    timerStatus: 'idle',
    durationSec: firstDuration,
    remainingSec: firstDuration,
    endsAt: null,
    previousSlideId: FieldValue.delete(),
    draftGraceUntil: FieldValue.delete(),
    revision: 0,
    updatedAt: now,
    updatedBy: ownerUid,
  }, { merge: true })
  batch.set(db.doc(`events/${EVENT_ID}/synthesis/current`), {
    organizerSummary: '',
    nicknamePolicy: 'nickname',
    themeIds: [],
    highlightAnswerIds: [],
    revision: 0,
    updatedAt: now,
    updatedBy: ownerUid,
  })
  batch.set(db.doc(`publicEvents/${PUBLIC_SLUG}`), {
    eventId: EVENT_ID,
    title: room.title,
    tagline: room.tagline,
    join: {
      participantCount: 0,
      room,
      slides: cleanSlides,
      live: {
        activeSlideId: firstSlide.id,
        activeSlideIndex: 0,
        startedAt: null,
        sessionStatus: 'lobby',
        timerStatus: 'idle',
        durationSec: firstDuration,
        remainingSec: firstDuration,
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
  batch.set(db.doc('systemMigrations/bootstrap-vibecoding-v3-clean'), {
    checksum: 'vibecoding-v3-clean-event',
    eventId: EVENT_ID,
    ownerUid,
    participantCount: 0,
    status: 'complete',
    completedAt: now,
  })
  batch.set(db.doc('roomCodes/VIBE26'), { eventId: EVENT_ID, updatedAt: now }, { merge: true })
  await batch.commit()

  console.log(JSON.stringify({
    status: 'complete',
    eventId: EVENT_ID,
    preservedOwner: OWNER_EMAIL,
    participantCount: 0,
    slidesPreserved: slides.size,
  }, null, 2))
}

void main().catch((cause: unknown) => {
  console.error(cause instanceof Error ? cause.message : cause)
  process.exitCode = 1
})
