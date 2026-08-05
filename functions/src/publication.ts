import { createHash } from 'node:crypto'
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore'
import { Timestamp } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'
import type { EventActor } from './lib/authz.js'
import { db } from './lib/firebase.js'

const MIN_PUBLICATION_INTERVAL_MS = 15_000

export function publicationThrottleRemainingMs(
  lastStartedAt: unknown,
  nowMs = Date.now(),
): number {
  if (!lastStartedAt || typeof lastStartedAt !== 'object' || !('toMillis' in lastStartedAt)) return 0
  const toMillis = (lastStartedAt as { toMillis?: unknown }).toMillis
  if (typeof toMillis !== 'function') return 0
  const startedAtMs = Number(toMillis.call(lastStartedAt))
  if (!Number.isFinite(startedAtMs)) return 0
  return Math.max(0, MIN_PUBLICATION_INTERVAL_MS - (nowMs - startedAtMs))
}

function publicKey(revision: number, kind: string, privateId: string): string {
  return createHash('sha256')
    .update(`${revision}\u0000${kind}\u0000${privateId}`, 'utf8')
    .digest('hex')
    .slice(0, 32)
}

function displayName(snapshot: QueryDocumentSnapshot, anonymous: boolean): string {
  return anonymous ? '익명의 참여자' : String(snapshot.get('authorName') ?? '참여자')
}

function instantValue(value: unknown): string {
  if (value instanceof Timestamp) return value.toDate().toISOString()
  return value instanceof Date ? value.toISOString() : String(value ?? '')
}

function ordered(docs: QueryDocumentSnapshot[]): QueryDocumentSnapshot[] {
  return [...docs].sort((left, right) => left.id.localeCompare(right.id))
}

interface PublicationExpectation {
  exhibitionPublished: boolean
  generation: number
}

export async function publishEventProjection(
  eventId: string,
  actor: EventActor,
  expectation?: PublicationExpectation,
): Promise<number> {
  const eventRef = db.doc(`events/${eventId}`)
  const [
    eventSnapshot,
    liveSnapshot,
    slidesSnapshot,
    answersSnapshot,
    commentsSnapshot,
    submissionsSnapshot,
    themesSnapshot,
    synthesisSnapshot,
  ] = await Promise.all([
    eventRef.get(),
    db.doc(`events/${eventId}/live/state`).get(),
    db.collection(`events/${eventId}/slides`).orderBy('order').get(),
    db.collection(`events/${eventId}/answers`).where('status', '==', 'submitted').get(),
    db.collection(`events/${eventId}/discussionComments`).get(),
    db.collection(`events/${eventId}/submissions`).where('status', '==', 'submitted').get(),
    db.collection(`events/${eventId}/themes`).get(),
    db.doc(`events/${eventId}/synthesis/current`).get(),
  ])
  if (!eventSnapshot.exists || !liveSnapshot.exists) {
    throw new HttpsError('not-found', '발행할 행사 정보를 찾을 수 없습니다.')
  }

  const slug = String(eventSnapshot.get('publicSlug') ?? '')
  if (!/^[a-z0-9-]{3,80}$/.test(slug)) {
    throw new HttpsError('failed-precondition', '공개 URL 슬러그를 확인해주세요.')
  }
  const publicRootRef = db.doc(`publicEvents/${slug}`)
  const capturedGeneration = Number(eventSnapshot.get('publicationGeneration') ?? 0)
  const capturedExhibitionState = eventSnapshot.get('exhibitionPublished') === true
  if (
    expectation
    && (
      capturedGeneration !== expectation.generation
      || capturedExhibitionState !== expectation.exhibitionPublished
    )
  ) {
    throw new HttpsError('aborted', '더 최신 행사 상태가 있어 이 발행 요청을 중단했습니다.')
  }
  const publicationGeneration = expectation?.generation ?? capturedGeneration
  const exhibitionPublished = expectation?.exhibitionPublished ?? capturedExhibitionState
  const revealedSlideIds = new Set(
    slidesSnapshot.docs
      .filter((slide) => slide.get('answersRevealed') === true)
      .map((slide) => slide.id),
  )
  const answers = answersSnapshot.docs.filter((answer) =>
    revealedSlideIds.has(String(answer.get('slideId') ?? '')),
  )
  const answerIds = new Set(answers.map((answer) => answer.id))
  const comments = commentsSnapshot.docs.filter((comment) =>
    comment.get('visibility') === 'event'
      && answerIds.has(String(comment.get('answerId') ?? '')),
  )
  const nicknamePolicy = synthesisSnapshot.get('nicknamePolicy') === 'anonymous'
    ? 'anonymous'
    : 'nickname'
  const anonymous = nicknamePolicy === 'anonymous'
  const selectedThemeIds = new Set(
    Array.isArray(synthesisSnapshot.get('themeIds'))
      ? synthesisSnapshot.get('themeIds') as string[]
      : [],
  )
  const selectedHighlightAnswerIds = Array.isArray(synthesisSnapshot.get('highlightAnswerIds'))
    ? synthesisSnapshot.get('highlightAnswerIds') as string[]
    : []
  const contentHash = createHash('sha256').update(JSON.stringify({
    event: {
      eventDate: String(eventSnapshot.get('eventDate') ?? ''),
      exhibitionPublished,
      organizerName: String(eventSnapshot.get('organizerName') ?? ''),
      participantCount: Number(eventSnapshot.get('participantCount') ?? 0),
      tagline: String(eventSnapshot.get('tagline') ?? ''),
      title: String(eventSnapshot.get('title') ?? ''),
    },
    synthesis: {
      highlightAnswerIds: [...selectedHighlightAnswerIds].sort(),
      nicknamePolicy,
      organizerSummary: String(synthesisSnapshot.get('organizerSummary') ?? ''),
      themeIds: [...selectedThemeIds].sort(),
    },
    slides: slidesSnapshot.docs.map((slide) => ({
      id: slide.id,
      eyebrow: String(slide.get('eyebrow') ?? ''),
      order: Number(slide.get('order') ?? 0),
      prompt: String(slide.get('prompt') ?? ''),
      title: String(slide.get('title') ?? ''),
    })),
    answers: ordered(answers).map((answer) => ({
      id: answer.id,
      authorName: displayName(answer, anonymous),
      content: String(answer.get('content') ?? ''),
      slideId: String(answer.get('slideId') ?? ''),
      submittedAt: instantValue(answer.get('submittedAt') ?? answer.get('updatedAt')),
    })),
    comments: ordered(comments).map((comment) => ({
      id: comment.id,
      answerId: String(comment.get('answerId') ?? ''),
      authorName: displayName(comment, anonymous),
      body: String(comment.get('body') ?? ''),
      createdAt: instantValue(comment.get('createdAt')),
    })),
    projects: exhibitionPublished ? ordered(submissionsSnapshot.docs).map((project) => ({
      id: project.id,
      authorName: displayName(project, anonymous),
      coverImage: String(project.get('coverImage') ?? ''),
      demoUrl: String(project.get('demoUrl') ?? ''),
      description: String(project.get('description') ?? ''),
      githubUrl: String(project.get('githubUrl') ?? ''),
      pitch: String(project.get('pitch') ?? ''),
      retrospective: String(project.get('retrospective') ?? ''),
      submittedAt: instantValue(project.get('submittedAt') ?? project.get('updatedAt')),
      tags: Array.isArray(project.get('tags')) ? project.get('tags') : [],
      title: String(project.get('title') ?? ''),
    })) : [],
    themes: ordered(themesSnapshot.docs.filter((theme) => selectedThemeIds.has(theme.id))).map((theme) => ({
      id: theme.id,
      answerIds: Array.isArray(theme.get('answerIds')) ? theme.get('answerIds') : [],
      color: String(theme.get('color') ?? ''),
      description: String(theme.get('description') ?? ''),
      label: String(theme.get('label') ?? ''),
    })),
  })).digest('hex')
  const now = Timestamp.now()
  const allocation = await db.runTransaction(async (transaction) => {
    const publicRoot = await transaction.get(publicRootRef)
    const latestRevision = Number(publicRoot.get('latestRevision') ?? 0)
    if (latestRevision > 0 && publicRoot.get('contentHash') === contentHash) {
      return { noOp: true, revision: latestRevision }
    }
    const throttleRemainingMs = publicationThrottleRemainingMs(
      publicRoot.get('lastPublicationStartedAt'),
      now.toMillis(),
    )
    if (throttleRemainingMs > 0) {
      throw new HttpsError(
        'resource-exhausted',
        `발행 후 ${Math.ceil(throttleRemainingMs / 1_000)}초 뒤에 다시 시도해주세요.`,
      )
    }
    // Keep allocation separate from the latest successfully published
    // revision. A failed build must never make the next retry collide with
    // the failed revision document.
    const nextRevision = Math.max(
      Number(publicRoot.get('revisionSequence') ?? 0),
      latestRevision,
    ) + 1
    transaction.set(publicRootRef, {
      lastPublicationStartedAt: now,
      revisionSequence: nextRevision,
    }, { merge: true })
    transaction.create(db.doc(`publicEvents/${slug}/revisions/${nextRevision}`), {
      revision: nextRevision,
      status: 'building',
      eventId,
      startedAt: now,
      startedBy: actor.uid,
    })
    return { noOp: false, revision: nextRevision }
  })
  if (allocation.noOp) return allocation.revision
  const revision = allocation.revision
  const answerKeyById = new Map(
    answers.map((answer) => [answer.id, publicKey(revision, 'answer', answer.id)]),
  )
  const highlightAnswerKeys = selectedHighlightAnswerIds
    .map((answerId) => answerKeyById.get(answerId))
    .filter((value): value is string => typeof value === 'string')
  const respondingParticipants = new Set(answers.map((answer) => answer.get('authorUid'))).size
  const participantCount = Number(eventSnapshot.get('participantCount') ?? 0)
  const revisionRef = db.doc(`publicEvents/${slug}/revisions/${revision}`)
  const writer = db.bulkWriter()

  for (const slide of slidesSnapshot.docs) {
    writer.create(revisionRef.collection('stages').doc(slide.id), {
      id: slide.id,
      order: Number(slide.get('order') ?? 0),
      eyebrow: String(slide.get('eyebrow') ?? ''),
      title: String(slide.get('title') ?? ''),
      prompt: String(slide.get('prompt') ?? ''),
    })
  }
  for (const answer of answers) {
    const key = answerKeyById.get(answer.id)!
    writer.create(revisionRef.collection('answers').doc(key), {
      id: key,
      stageId: String(answer.get('slideId') ?? ''),
      authorName: displayName(answer, anonymous),
      content: String(answer.get('content') ?? ''),
      submittedAt: answer.get('submittedAt') ?? answer.get('updatedAt') ?? now,
    })
  }
  for (const comment of comments) {
    const key = publicKey(revision, 'comment', comment.id)
    writer.create(revisionRef.collection('comments').doc(key), {
      id: key,
      answerId: answerKeyById.get(String(comment.get('answerId')))!,
      authorName: displayName(comment, anonymous),
      body: String(comment.get('body') ?? ''),
      createdAt: comment.get('createdAt') ?? now,
    })
  }
  if (exhibitionPublished) {
    for (const project of submissionsSnapshot.docs) {
      const key = publicKey(revision, 'project', project.id)
      writer.create(revisionRef.collection('projects').doc(key), {
        id: key,
        authorName: displayName(project, anonymous),
        title: String(project.get('title') ?? ''),
        pitch: String(project.get('pitch') ?? ''),
        description: String(project.get('description') ?? ''),
        demoUrl: String(project.get('demoUrl') ?? ''),
        githubUrl: String(project.get('githubUrl') ?? ''),
        tags: Array.isArray(project.get('tags')) ? project.get('tags') : [],
        retrospective: String(project.get('retrospective') ?? ''),
        coverImage: String(project.get('coverImage') ?? ''),
        submittedAt: project.get('submittedAt') ?? project.get('updatedAt') ?? now,
      })
    }
  }
  for (const theme of themesSnapshot.docs.filter((item) => selectedThemeIds.has(item.id))) {
    const privateAnswerIds = Array.isArray(theme.get('answerIds'))
      ? theme.get('answerIds') as string[]
      : []
    const themeAnswers = answers.filter((answer) => privateAnswerIds.includes(answer.id))
    writer.create(revisionRef.collection('themes').doc(theme.id), {
      id: theme.id,
      label: String(theme.get('label') ?? ''),
      description: String(theme.get('description') ?? ''),
      color: String(theme.get('color') ?? '#3157C8'),
      answerCount: themeAnswers.length,
      excerpts: themeAnswers.slice(0, 3).map((answer) => String(answer.get('content') ?? '')),
    })
  }

  try {
    await writer.close()
  } catch (error) {
    await revisionRef.set({
      status: 'failed',
      failedAt: Timestamp.now(),
      failureCode: 'projection-write-failed',
    }, { merge: true })
    throw error
  }

  const metrics = {
    participantCount,
    submittedAnswerCount: answers.length,
    commentCount: comments.length,
    projectCount: exhibitionPublished ? submissionsSnapshot.size : 0,
    completionRate: participantCount === 0
      ? 0
      : Math.round((respondingParticipants / participantCount) * 100),
  }
  const promoted = await db.runTransaction(async (transaction) => {
    const [currentPublicRoot, currentEvent] = await Promise.all([
      transaction.get(publicRootRef),
      transaction.get(eventRef),
    ])
    const currentRevision = Number(currentPublicRoot.get('latestRevision') ?? 0)
    transaction.update(revisionRef, {
      status: 'published',
      title: String(eventSnapshot.get('title') ?? ''),
      tagline: String(eventSnapshot.get('tagline') ?? ''),
      organizerName: String(eventSnapshot.get('organizerName') ?? ''),
      eventDate: String(eventSnapshot.get('eventDate') ?? ''),
      summary: String(synthesisSnapshot.get('organizerSummary') ?? ''),
      nicknamePolicy,
      exhibitionPublished,
      highlightAnswerKeys,
      metrics,
      publishedAt: now,
      completedAt: Timestamp.now(),
    })
    // A slower publication must never move the public pointer back from R3 to R2.
    const eventStateStillCurrent = Number(currentEvent.get('publicationGeneration') ?? 0)
      === publicationGeneration
      && currentEvent.get('exhibitionPublished') === exhibitionPublished
    if (revision > currentRevision && eventStateStillCurrent) {
      transaction.set(publicRootRef, {
        eventId,
        contentHash,
        join: { participantCount },
        title: String(eventSnapshot.get('title') ?? ''),
        tagline: String(eventSnapshot.get('tagline') ?? ''),
        latestRevision: revision,
        published: true,
        exhibitionPublished,
        updatedAt: now,
      }, { merge: true })
      transaction.update(eventRef, { publishedRevision: revision, updatedAt: now })
      return true
    }
    return false
  })
  if (!promoted) {
    throw new HttpsError('aborted', '더 최신 행사 상태가 있어 이 리비전은 공개하지 않았습니다.')
  }
  return revision
}
