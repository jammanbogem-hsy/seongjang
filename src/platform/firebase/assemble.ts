import {
  PROTOTYPE_SCHEMA_VERSION,
  type AdminInvite,
  type Answer,
  type Comment,
  type LiveSession,
  type Participant,
  type PrototypeState,
  type PublishedSnapshot,
  type ReviewMessage,
  type ReviewThread,
  type Room,
  type Slide,
  type Submission,
  type Synthesis,
  type Theme,
} from '../../domain/models'
import type { FirebaseDocumentRecord } from './driver'
import type {
  FirebaseAnswerDraftView,
  FirebaseBackendSnapshot,
  FirebaseEntityBundle,
  FirebaseProjectDraftView,
} from './types'

const EMPTY_ISO = '1970-01-01T00:00:00.000Z'

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function boolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function stringMap(value: unknown): Record<string, boolean> {
  return Object.fromEntries(
    Object.entries(object(value)).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'),
  )
}

function timestampDate(value: unknown): Date | null {
  if (value instanceof Date) return value
  if (typeof value === 'string' || typeof value === 'number') {
    const candidate = new Date(value)
    return Number.isNaN(candidate.getTime()) ? null : candidate
  }
  if (value && typeof value === 'object' && 'toDate' in value) {
    const toDate = (value as { toDate?: unknown }).toDate
    if (typeof toDate === 'function') {
      const candidate = toDate.call(value)
      return candidate instanceof Date ? candidate : null
    }
  }
  const seconds = number(object(value).seconds, Number.NaN)
  return Number.isNaN(seconds) ? null : new Date(seconds * 1_000)
}

function iso(value: unknown, fallback = EMPTY_ISO): string {
  return timestampDate(value)?.toISOString() ?? fallback
}

function millis(value: unknown): number | null {
  if (value === null || value === undefined) return null
  return timestampDate(value)?.getTime() ?? null
}

function documentData(record: FirebaseDocumentRecord): Record<string, unknown> {
  return { id: record.id, ...record.data }
}

function parsePublishedSnapshot(record: FirebaseDocumentRecord | null): PublishedSnapshot | null {
  if (!record) return null
  const candidate = object(record.data.publishedSnapshot ?? record.data.snapshot ?? record.data)
  const data = candidate.data
  if (!data || typeof data !== 'object') return null
  return {
    revision: number(candidate.revision),
    publishedAt: iso(candidate.publishedAt),
    data: data as PublishedSnapshot['data'],
  }
}

function roomFromPublic(snapshot: PublishedSnapshot): Room {
  return {
    id: snapshot.data.roomCode,
    capacity: snapshot.data.capacity,
    participantCount: snapshot.data.metrics.participantCount,
    code: snapshot.data.roomCode,
    eventDate: snapshot.data.eventDate,
    organizerName: snapshot.data.organizerName,
    tagline: snapshot.data.tagline,
    title: snapshot.data.title,
  }
}

function parseRoom(event: FirebaseDocumentRecord | null, snapshot: PublishedSnapshot | null): Room | null {
  if (!event) return snapshot ? roomFromPublic(snapshot) : null
  const source = object(event.data.room)
  const data = Object.keys(source).length ? source : event.data
  return {
    id: text(data.id, event.id),
    capacity: number(data.capacity, 100),
    participantCount: number(event.data.participantCount, number(data.participantCount)),
    code: text(data.code),
    eventDate: text(data.eventDate),
    organizerName: text(data.organizerName),
    tagline: text(data.tagline),
    title: text(data.title),
  }
}

function parseSlides(records: FirebaseDocumentRecord[]): Slide[] {
  return records.map((record) => {
    const data = documentData(record)
    return {
      id: record.id,
      durationSec: number(data.durationSec),
      eyebrow: text(data.eyebrow),
      helper: text(data.helper),
      illustration: text(data.illustration),
      order: number(data.order),
      prompt: text(data.prompt),
      title: text(data.title),
    }
  }).sort((left, right) => left.order - right.order)
}

function parseLive(
  record: FirebaseDocumentRecord | null,
  slides: Slide[],
  slideRecords: FirebaseDocumentRecord[],
): LiveSession {
  const data = record?.data ?? {}
  const activeSlideId = text(data.activeSlideId)
  const activeSlideIndex = activeSlideId
    ? Math.max(0, slides.findIndex((slide) => slide.id === activeSlideId))
    : Math.max(0, Math.min(number(data.activeSlideIndex), Math.max(0, slides.length - 1)))
  const timer = object(data.timer)
  const revealedFromSlides = Object.fromEntries(slideRecords.map((slide) => [
    slide.id,
    boolean(slide.data.answersRevealed),
  ]))
  const commentsFromSlides = Object.fromEntries(slideRecords.map((slide) => [
    slide.id,
    boolean(slide.data.commentsEnabled),
  ]))
  const timerStatus = timer.status ?? data.timerStatus
  return {
    activeSlideIndex,
    answersRevealedBySlide: Object.keys(object(data.answersRevealedBySlide)).length
      ? stringMap(data.answersRevealedBySlide)
      : revealedFromSlides,
    commentsEnabledBySlide: Object.keys(object(data.commentsEnabledBySlide)).length
      ? stringMap(data.commentsEnabledBySlide)
      : commentsFromSlides,
    startedAt: data.startedAt ? iso(data.startedAt) : null,
    timer: {
      durationSec: number(timer.durationSec ?? data.durationSec),
      endsAt: millis(timer.endsAt ?? data.endsAt),
      remainingSec: number(timer.remainingSec ?? data.remainingSec),
      status: timerStatus === 'running' || timerStatus === 'paused' || timerStatus === 'complete'
        ? timerStatus
        : 'idle',
    },
  }
}

function parseParticipants(records: FirebaseDocumentRecord[]): Participant[] {
  return records.map((record) => {
    const data = documentData(record)
    const nickname = text(data.nickname)
    return {
      id: record.id,
      accent: text(data.accent, '#3157C8'),
      joinedAt: iso(data.joinedAt),
      lastSeenAt: iso(data.lastSeenAt ?? data.joinedAt),
      nickname,
      normalizedNickname: text(data.normalizedNickname, nickname.toLocaleLowerCase()),
      // PIN secrets are intentionally never part of a realtime view model.
      pin: '',
      status: data.status === 'online' ? 'online' : 'offline',
    }
  })
}

function parseAnswerRecord(record: FirebaseDocumentRecord, status: Answer['status']): Answer {
  const data = documentData(record)
  return {
    id: record.id,
    content: text(data.submittedContent ?? data.content),
    createdAt: iso(data.createdAt ?? data.updatedAt),
    participantId: text(data.ownerParticipantId ?? data.participantId),
    slideId: text(data.slideId),
    status,
    submittedAt: status === 'submitted' ? iso(data.submittedAt ?? data.updatedAt) : null,
    updatedAt: iso(data.updatedAt),
  }
}

function parseAnswerDrafts(records: FirebaseDocumentRecord[]): FirebaseAnswerDraftView[] {
  return records.map((record) => {
    const data = documentData(record)
    return {
      content: text(data.content),
      hasPendingWrites: Boolean(record.hasPendingWrites),
      participantId: text(data.ownerParticipantId ?? data.participantId),
      revision: number(data.revision),
      slideId: text(data.slideId),
      updatedAt: iso(data.updatedAt),
    }
  })
}

function parseAnswers(
  submittedRecords: FirebaseDocumentRecord[],
  drafts: FirebaseAnswerDraftView[],
): Answer[] {
  const submitted = submittedRecords.map((record) => parseAnswerRecord(record, 'submitted'))
  const draftAnswers = drafts.map((draft) => ({
    id: `draft-${draft.participantId}-${draft.slideId}`,
    content: draft.content,
    createdAt: draft.updatedAt,
    participantId: draft.participantId,
    slideId: draft.slideId,
    status: 'draft' as const,
    submittedAt: null,
    draftRevision: draft.revision,
    updatedAt: draft.updatedAt,
  }))
  // Keep the editable draft alongside the immutable submitted answer. Draft-first
  // ordering also lets legacy consumers that select the first owner/slide match
  // resume the latest editable text after reconnecting.
  return [...draftAnswers, ...submitted]
}

function parseComments(records: FirebaseDocumentRecord[]): Comment[] {
  return records.map((record) => {
    const data = documentData(record)
    return {
      id: record.id,
      answerId: text(data.answerId),
      body: text(data.body),
      createdAt: iso(data.createdAt),
      participantId: text(data.authorParticipantId ?? data.participantId),
      updatedAt: iso(data.updatedAt ?? data.createdAt),
    }
  })
}

function parseReviewMessage(value: unknown, fallbackId: string): ReviewMessage {
  const data = object(value)
  return {
    id: text(data.id, fallbackId),
    authorRole: data.authorRole === 'participant' ? 'participant' : 'organizer',
    body: text(data.body),
    createdAt: iso(data.createdAt),
    participantId: data.authorRole === 'participant'
      ? text(data.authorParticipantId ?? data.participantId) || null
      : null,
    updatedAt: iso(data.updatedAt ?? data.createdAt),
  }
}

function parseReviewThreads(records: FirebaseDocumentRecord[]): ReviewThread[] {
  return records.map((record) => {
    const data = documentData(record)
    const messages = Array.isArray(data.messages)
      ? data.messages.map((message, index) => parseReviewMessage(message, `${record.id}-${index}`))
      : []
    return {
      id: record.id,
      createdAt: iso(data.createdAt),
      field: text(data.field, '전체'),
      messages,
      quote: text(data.quote),
      resolvedAt: data.resolvedAt ? iso(data.resolvedAt) : null,
      status: data.status === 'resolved' ? 'resolved' : 'open',
      targetId: text(data.targetId),
      targetType: data.targetType === 'submission' ? 'submission' : 'answer',
      updatedAt: iso(data.updatedAt ?? data.createdAt),
    }
  })
}

function submissionFromData(record: FirebaseDocumentRecord, status: Submission['status']): Submission {
  const data = object(record.data.submittedSnapshot ?? record.data)
  return {
    id: record.id,
    coverImage: text(data.coverImage, '/assets/illustrations/cat-submission.webp'),
    createdAt: iso(data.createdAt ?? data.updatedAt),
    demoUrl: text(data.demoUrl),
    description: text(data.description),
    githubUrl: text(data.githubUrl),
    participantId: text(data.ownerParticipantId ?? data.participantId),
    pitch: text(data.pitch),
    retrospective: text(data.retrospective),
    status,
    submittedAt: status === 'submitted' ? iso(data.submittedAt ?? data.updatedAt) : null,
    tags: strings(data.tags),
    title: text(data.title),
    updatedAt: iso(data.updatedAt),
  }
}

function parseProjectDrafts(records: FirebaseDocumentRecord[]): FirebaseProjectDraftView[] {
  return records.map((record) => {
    const data = documentData(record)
    return {
      description: text(data.description),
      demoUrl: text(data.demoUrl),
      githubUrl: text(data.githubUrl),
      hasPendingWrites: Boolean(record.hasPendingWrites),
      participantId: text(data.ownerParticipantId ?? data.participantId, record.id),
      pitch: text(data.pitch),
      retrospective: text(data.retrospective),
      status: 'draft',
      tags: strings(data.tags),
      title: text(data.title),
      updatedAt: iso(data.updatedAt),
      revision: number(data.revision),
    }
  })
}

function parseSubmissions(
  records: FirebaseDocumentRecord[],
  drafts: FirebaseProjectDraftView[],
): Submission[] {
  const submitted = records.map((record) => submissionFromData(record, 'submitted'))
  const draftSubmissions = drafts.map((draft): Submission => ({
    id: `draft-${draft.participantId}`,
    coverImage: '/assets/illustrations/cat-submission.webp',
    createdAt: draft.updatedAt,
    demoUrl: draft.demoUrl,
    description: draft.description,
    githubUrl: draft.githubUrl,
    participantId: draft.participantId,
    pitch: draft.pitch,
    retrospective: draft.retrospective,
    status: 'draft',
    submittedAt: null,
    draftRevision: draft.revision,
    tags: draft.tags,
    title: draft.title,
    updatedAt: draft.updatedAt,
  }))
  // Submission history must not hide edits made after the last submit.
  return [...draftSubmissions, ...submitted]
}

function parseInvites(records: FirebaseDocumentRecord[]): AdminInvite[] {
  return records.map((record) => {
    const data = documentData(record)
    return {
      acceptedBy: text(data.acceptedBy) || undefined,
      id: record.id,
      email: text(data.email),
      invitedAt: iso(data.invitedAt),
      status: data.status === 'accepted' || data.status === 'revoked' ? data.status : 'pending',
    }
  })
}

function parseThemes(records: FirebaseDocumentRecord[]): Theme[] {
  return records.map((record) => {
    const data = documentData(record)
    return {
      id: record.id,
      answerIds: strings(data.answerIds),
      color: text(data.color),
      description: text(data.description),
      label: text(data.label),
    }
  })
}

function parseSynthesis(record: FirebaseDocumentRecord | null): Synthesis {
  const data = record?.data ?? {}
  return {
    highlightAnswerIds: strings(data.highlightAnswerIds),
    nicknamePolicy: data.nicknamePolicy === 'anonymous' ? 'anonymous' : 'nickname',
    organizerSummary: text(data.organizerSummary),
    revision: number(data.revision),
    themeIds: strings(data.themeIds),
    updatedAt: iso(data.updatedAt),
  }
}

export function assembleFirebaseSnapshot(
  bundle: FirebaseEntityBundle,
  metadata: { fromCache: boolean; hasPendingWrites: boolean },
): FirebaseBackendSnapshot | null {
  const publishedSnapshot = parsePublishedSnapshot(bundle.publishedSnapshot)
  const room = parseRoom(bundle.event, publishedSnapshot)
  if (!room) return null
  const slides = parseSlides(bundle.slides)
  const answerDrafts = parseAnswerDrafts(bundle.answerDrafts)
  const projectDrafts = parseProjectDrafts(bundle.projectDrafts)
  const eventData = bundle.event?.data ?? {}
  const state: PrototypeState = {
    schemaVersion: PROTOTYPE_SCHEMA_VERSION,
    revision: number(eventData.revision),
    room,
    participants: parseParticipants(bundle.participants),
    adminInvites: parseInvites(bundle.adminInvites),
    slides,
    live: parseLive(bundle.live, slides, bundle.slides),
    answers: parseAnswers(bundle.answers, answerDrafts),
    comments: parseComments(bundle.comments),
    reviewThreads: parseReviewThreads(bundle.reviewThreads),
    themes: parseThemes(bundle.themes),
    submissions: parseSubmissions(bundle.submissions, projectDrafts),
    synthesis: parseSynthesis(bundle.synthesis),
    exhibitionPublished: boolean(eventData.exhibitionPublished, publishedSnapshot?.data.exhibitionPublished ?? false),
    publishedSnapshot,
  }
  return {
    answerDrafts,
    fromCache: metadata.fromCache,
    hasPendingWrites: metadata.hasPendingWrites,
    projectDrafts,
    state,
  }
}
