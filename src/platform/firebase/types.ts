import type { PrototypeState, SlideInputField, SubmissionStatus } from '../../domain/models'
import type { FirebaseBackendDriver, FirebaseDocumentRecord } from './driver'

export type FirebaseViewRole = 'organizer' | 'participant' | 'public'
export type FirebaseDraftPhase = 'local' | 'pending' | 'confirmed' | 'rejected'

export interface FirebaseDraftStatus {
  error?: Error
  mutationId: string
  phase: FirebaseDraftPhase
  updatedAt: Date
}

export interface FirebaseDraftWrite {
  confirmation: Promise<FirebaseDraftStatus>
  mutationId: string
}

export interface FirebaseAnswerDraftView {
  content: string
  hasPendingWrites: boolean
  participantId: string
  slideId: string
  updatedAt: string
  revision: number
}

export interface FirebaseProjectDraftView {
  coverImage: string
  description: string
  demoUrl: string
  githubUrl: string
  hasPendingWrites: boolean
  participantId: string
  pitch: string
  retrospective: string
  status: SubmissionStatus
  tags: string[]
  title: string
  updatedAt: string
  revision: number
}

export interface FirebaseBackendSnapshot {
  answerDrafts: FirebaseAnswerDraftView[]
  fromCache: boolean
  hasPendingWrites: boolean
  projectDrafts: FirebaseProjectDraftView[]
  state: PrototypeState
}

export interface FirebaseEntityBundle {
  adminInvites: FirebaseDocumentRecord[]
  answerDrafts: FirebaseDocumentRecord[]
  answers: FirebaseDocumentRecord[]
  comments: FirebaseDocumentRecord[]
  event: FirebaseDocumentRecord | null
  live: FirebaseDocumentRecord | null
  liveChatMessages: FirebaseDocumentRecord[]
  liveReactions: FirebaseDocumentRecord[]
  participants: FirebaseDocumentRecord[]
  projectDrafts: FirebaseDocumentRecord[]
  publishedSnapshot: FirebaseDocumentRecord | null
  reviewThreads: FirebaseDocumentRecord[]
  slides: FirebaseDocumentRecord[]
  submissions: FirebaseDocumentRecord[]
  synthesis: FirebaseDocumentRecord | null
  themes: FirebaseDocumentRecord[]
}

export interface CreateFirebaseBackendOptions {
  driver?: FirebaseBackendDriver
  eventId: string
  includePublishedSnapshot?: boolean
  participantId?: string
  publicSlug?: string
  role: FirebaseViewRole
}

export interface SaveAnswerDraftRequest {
  baseRevision: number
  content: string
  slideId: string
}

export interface SaveProjectDraftRequest {
  baseRevision: number
  coverImage?: string
  description: string
  demoUrl?: string
  githubUrl?: string
  pitch: string
  retrospective: string
  tags?: string[]
  title: string
}

export interface SavePrivateDraftRequest {
  payload: Record<string, unknown>
  targetId: string
  targetType: 'comment' | 'comment-edit' | 'review-composer' | 'review-reply'
}

export interface SaveSynthesisDraftRequest {
  highlightAnswerIds?: string[]
  nicknamePolicy?: 'nickname' | 'anonymous'
  organizerSummary?: string
  themeIds?: string[]
}

export type FirebaseAuthoritativeCommand =
  | { type: 'SET_ACTIVE_SLIDE'; slideId: string }
  | {
      type: 'CREATE_SLIDE'
      durationSec: number
      eyebrow: string
      helper: string
      illustration: string
      prompt: string
      title: string
      inputFields?: SlideInputField[]
    }
  | { type: 'DELETE_SLIDE'; slideId: string }
  | { type: 'MOVE_SLIDE'; direction: 'up' | 'down'; slideId: string }
  | { type: 'REORDER_SLIDES'; orderedSlideIds: string[] }
  | { type: 'END_SESSION' }
  | { type: 'SET_TIMER_DURATION'; durationSec: number }
  | { type: 'START_SESSION' }
  | { type: 'START_TIMER' | 'PAUSE_TIMER' | 'RESUME_TIMER' | 'RESET_TIMER' }
  | { type: 'SET_ANSWERS_REVEALED'; slideId: string; revealed: boolean }
  | { type: 'SET_COMMENTS_ENABLED'; slideId: string; enabled: boolean }
  | {
      type: 'UPDATE_SLIDE'
      eyebrow: string
      helper: string
      prompt: string
      slideId: string
      title: string
      inputFields?: SlideInputField[]
    }
  | { type: 'SUBMIT_ANSWER'; slideId: string }
  | { type: 'ADD_COMMENT'; answerId: string; body: string }
  | { type: 'SET_LIVE_REACTION'; slideId: string; kind: 'like' | 'love' | 'idea' | 'question' | null }
  | { type: 'SEND_LIVE_CHAT_MESSAGE'; slideId: string; body: string; replyToId?: string | null }
  | { type: 'DELETE_LIVE_CHAT_MESSAGE'; messageId: string }
  | { type: 'UPDATE_COMMENT'; commentId: string; body: string }
  | { type: 'DELETE_COMMENT'; commentId: string }
  | {
      type: 'ADD_REVIEW_THREAD'
      body: string
      field: string
      quote?: string
      targetId: string
      targetType: 'answer' | 'submission'
    }
  | { type: 'ADD_REVIEW_REPLY'; body: string; threadId: string }
  | { type: 'SET_REVIEW_THREAD_STATUS'; status: 'open' | 'resolved'; threadId: string }
  | { type: 'SUBMIT_PROJECT' }
  | { type: 'INVITE_ADMIN'; email: string }
  | { type: 'REVOKE_ADMIN'; inviteId: string }
  | {
      type: 'UPDATE_SYNTHESIS'
      expectedRevision: number
      highlightAnswerIds?: string[]
      nicknamePolicy?: 'nickname' | 'anonymous'
      organizerSummary?: string
      themeIds?: string[]
    }
  | { type: 'PUBLISH_SYNTHESIS' }
  | { type: 'SET_EXHIBITION_PUBLISHED'; published: boolean }

export interface FirebaseCommandSuccess<T = unknown> {
  notice?: string
  operationId?: string
  value: T
}

export interface FirebaseBackend {
  execute<T = unknown>(command: FirebaseAuthoritativeCommand): Promise<FirebaseCommandSuccess<T>>
  revealParticipantPin(participantId: string, reason: string): Promise<{ expiresAt: string; pin: string }>
  saveAnswerDraft(
    request: SaveAnswerDraftRequest,
    onStatus?: (status: FirebaseDraftStatus) => void,
  ): FirebaseDraftWrite
  savePrivateDraft(
    request: SavePrivateDraftRequest,
    onStatus?: (status: FirebaseDraftStatus) => void,
  ): FirebaseDraftWrite
  saveProjectDraft(
    request: SaveProjectDraftRequest,
    onStatus?: (status: FirebaseDraftStatus) => void,
  ): FirebaseDraftWrite
  saveSynthesisDraft(
    request: SaveSynthesisDraftRequest,
    onStatus?: (status: FirebaseDraftStatus) => void,
  ): FirebaseDraftWrite
  subscribe(
    listener: (snapshot: FirebaseBackendSnapshot) => void,
    onError?: (cause: Error) => void,
  ): () => void
}
