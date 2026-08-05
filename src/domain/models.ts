export const PROTOTYPE_SCHEMA_VERSION = 1 as const
export const ROOM_CAPACITY = 100 as const

export type Identifier = string
export type ParticipantStatus = 'online' | 'offline'
export type TimerStatus = 'idle' | 'running' | 'paused' | 'complete'
export type AnswerStatus = 'draft' | 'submitted'
export type SubmissionStatus = 'draft' | 'submitted'
export type InvitationStatus = 'pending' | 'accepted' | 'revoked'
export type NicknamePolicy = 'nickname' | 'anonymous'
export type ReviewTargetType = 'answer' | 'submission'
export type ReviewAuthorRole = 'organizer' | 'participant'
export type ReviewThreadStatus = 'open' | 'resolved'

export interface Room {
  id: Identifier
  code: string
  title: string
  tagline: string
  organizerName: string
  eventDate: string
  capacity: number
  participantCount?: number
}

export interface Participant {
  id: Identifier
  nickname: string
  normalizedNickname: string
  pin: string
  joinedAt: string
  lastSeenAt: string
  status: ParticipantStatus
  accent: string
}

export interface AdminInvite {
  acceptedBy?: Identifier
  id: Identifier
  email: string
  status: InvitationStatus
  invitedAt: string
}

export interface Slide {
  id: Identifier
  order: number
  eyebrow: string
  title: string
  prompt: string
  helper: string
  durationSec: number
  illustration: string
}

export interface LiveTimer {
  durationSec: number
  remainingSec: number
  status: TimerStatus
  endsAt: number | null
}

export interface LiveSession {
  activeSlideIndex: number
  startedAt: string | null
  timer: LiveTimer
  answersRevealedBySlide: Record<Identifier, boolean>
  commentsEnabledBySlide: Record<Identifier, boolean>
}

export interface Answer {
  id: Identifier
  participantId: Identifier
  slideId: Identifier
  content: string
  status: AnswerStatus
  createdAt: string
  updatedAt: string
  submittedAt: string | null
  draftRevision?: number
}

export interface Comment {
  id: Identifier
  participantId: Identifier
  answerId: Identifier
  body: string
  createdAt: string
  updatedAt: string
}

export interface ReviewMessage {
  id: Identifier
  authorRole: ReviewAuthorRole
  participantId: Identifier | null
  body: string
  createdAt: string
  updatedAt: string
}

export interface ReviewThread {
  id: Identifier
  targetType: ReviewTargetType
  targetId: Identifier
  field: string
  quote: string
  status: ReviewThreadStatus
  messages: ReviewMessage[]
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
}

export interface Theme {
  id: Identifier
  label: string
  description: string
  color: string
  answerIds: Identifier[]
}

export interface Submission {
  id: Identifier
  participantId: Identifier
  title: string
  pitch: string
  description: string
  demoUrl: string
  githubUrl: string
  tags: string[]
  retrospective: string
  coverImage: string
  status: SubmissionStatus
  createdAt: string
  updatedAt: string
  submittedAt: string | null
  draftRevision?: number
}

export interface Synthesis {
  organizerSummary: string
  nicknamePolicy: NicknamePolicy
  themeIds: Identifier[]
  highlightAnswerIds: Identifier[]
  revision: number
  updatedAt: string
}

export interface PublicAuthor {
  name: string
}

export interface PublicComment {
  author: PublicAuthor
  body: string
  createdAt: string
}

export interface PublicAnswer {
  key: string
  author: PublicAuthor
  content: string
  submittedAt: string
  comments: PublicComment[]
}

export interface PublicStage {
  key: string
  order: number
  eyebrow: string
  title: string
  prompt: string
  answers: PublicAnswer[]
}

export interface PublicTheme {
  label: string
  description: string
  color: string
  answerCount: number
  excerpts: string[]
}

export interface PublicProject {
  key: string
  maker: PublicAuthor
  title: string
  pitch: string
  description: string
  demoUrl: string
  githubUrl: string
  tags: string[]
  retrospective: string
  coverImage: string
  submittedAt: string
}

export interface PublicMetrics {
  participantCount: number
  submittedAnswerCount: number
  commentCount: number
  projectCount: number
  completionRate: number
}

export interface PublicEventProjection {
  title: string
  tagline: string
  organizerName: string
  eventDate: string
  roomCode: string
  capacity: number
  summary: string
  nicknamePolicy: NicknamePolicy
  metrics: PublicMetrics
  stages: PublicStage[]
  themes: PublicTheme[]
  highlights: PublicAnswer[]
  exhibitionPublished: boolean
  projects: PublicProject[]
}

export interface PublishedSnapshot {
  revision: number
  publishedAt: string
  data: PublicEventProjection
}

export interface PrototypeState {
  schemaVersion: typeof PROTOTYPE_SCHEMA_VERSION
  revision: number
  room: Room
  participants: Participant[]
  adminInvites: AdminInvite[]
  slides: Slide[]
  live: LiveSession
  answers: Answer[]
  comments: Comment[]
  reviewThreads: ReviewThread[]
  themes: Theme[]
  submissions: Submission[]
  synthesis: Synthesis
  exhibitionPublished: boolean
  publishedSnapshot: PublishedSnapshot | null
}

export interface TimerView {
  remainingSec: number
  status: TimerStatus
  progress: number
}

export type CommandErrorCode =
  | 'INVALID_ROOM'
  | 'INVALID_NICKNAME'
  | 'INVALID_PIN'
  | 'PIN_MISMATCH'
  | 'ROOM_FULL'
  | 'NOT_FOUND'
  | 'NOT_ALLOWED'
  | 'INVALID_CONTENT'
  | 'INVALID_EMAIL'
  | 'DUPLICATE_INVITE'
  | 'INVALID_SUBMISSION'

export interface CommandError {
  code: CommandErrorCode
  message: string
}

export type CommandResult<T = undefined> =
  | { ok: true; value: T; notice?: string }
  | { ok: false; error: CommandError }

export interface JoinParticipantInput {
  entryCode?: string
  roomCode: string
  nickname: string
  pin: string
}

export interface SaveAnswerInput {
  baseRevision?: number
  participantId: Identifier
  slideId: Identifier
  content: string
  submit?: boolean
}

export interface AddCommentInput {
  participantId: Identifier
  answerId: Identifier
  body: string
}

export interface UpdateCommentInput {
  participantId: Identifier
  commentId: Identifier
  body: string
}

export interface DeleteCommentInput {
  participantId: Identifier
  commentId: Identifier
}

export interface AddReviewThreadInput {
  targetType: ReviewTargetType
  targetId: Identifier
  field: string
  quote?: string
  body: string
}

export interface AddReviewReplyInput {
  threadId: Identifier
  authorRole: ReviewAuthorRole
  participantId?: Identifier
  body: string
}

export interface SetReviewThreadStatusInput {
  threadId: Identifier
  authorRole: ReviewAuthorRole
  participantId?: Identifier
  status: ReviewThreadStatus
}

export interface SubmitProjectInput {
  baseRevision?: number
  participantId: Identifier
  title: string
  pitch: string
  description: string
  demoUrl?: string
  githubUrl?: string
  tags?: string[]
  retrospective: string
  coverImage?: string
  submit?: boolean
}

export interface UpdateSynthesisInput {
  expectedRevision: number
  organizerSummary?: string
  nicknamePolicy?: NicknamePolicy
  themeIds?: Identifier[]
  highlightAnswerIds?: Identifier[]
}

export interface UpdateSlideInput {
  slideId: Identifier
  eyebrow: string
  title: string
  prompt: string
  helper: string
}

export type PlatformCommand =
  | { type: 'JOIN_PARTICIPANT'; input: JoinParticipantInput }
  | { type: 'SET_PARTICIPANT_STATUS'; participantId: Identifier; status: ParticipantStatus }
  | { type: 'SET_ACTIVE_SLIDE'; slideIndex: number }
  | { type: 'SET_TIMER_DURATION'; durationSec: number }
  | { type: 'START_TIMER' }
  | { type: 'PAUSE_TIMER' }
  | { type: 'RESUME_TIMER' }
  | { type: 'RESET_TIMER' }
  | { type: 'SET_ANSWERS_REVEALED'; slideId: Identifier; revealed: boolean }
  | { type: 'SET_COMMENTS_ENABLED'; slideId: Identifier; enabled: boolean }
  | { type: 'UPDATE_SLIDE'; input: UpdateSlideInput }
  | { type: 'SAVE_ANSWER'; input: SaveAnswerInput }
  | { type: 'ADD_COMMENT'; input: AddCommentInput }
  | { type: 'UPDATE_COMMENT'; input: UpdateCommentInput }
  | { type: 'DELETE_COMMENT'; input: DeleteCommentInput }
  | { type: 'ADD_REVIEW_THREAD'; input: AddReviewThreadInput }
  | { type: 'ADD_REVIEW_REPLY'; input: AddReviewReplyInput }
  | { type: 'SET_REVIEW_THREAD_STATUS'; input: SetReviewThreadStatusInput }
  | { type: 'SUBMIT_PROJECT'; input: SubmitProjectInput }
  | { type: 'INVITE_ADMIN'; email: string }
  | { type: 'REVOKE_ADMIN'; inviteId: Identifier }
  | { type: 'ACCEPT_ADMIN_INVITE'; inviteId: Identifier }
  | { type: 'UPDATE_SYNTHESIS'; input: UpdateSynthesisInput }
  | { type: 'PUBLISH_SYNTHESIS' }
  | { type: 'SET_EXHIBITION_PUBLISHED'; published: boolean }
  | { type: 'RESET_DEMO' }

export interface CommandOutcome<T = unknown> {
  state: PrototypeState
  result: CommandResult<T>
}
