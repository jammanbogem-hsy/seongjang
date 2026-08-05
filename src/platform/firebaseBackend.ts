/**
 * Canonical production Firebase boundary.
 *
 * UI and providers should depend on these interfaces instead of importing the
 * Firebase SDK directly. The browser/localStorage backend remains a test-only
 * adapter and is deliberately not selected here as a runtime fallback.
 */
export {
  FIREBASE_CALLABLES,
  VIBECODING_FIREBASE_CONFIG,
  bootstrapVibe26Event,
  createFirebaseEventBackend,
  getFirebaseServices,
  joinParticipantWithPin,
  observeFirebaseAuthSession,
  resolveFirebaseEventMembership,
  signInOrganizerWithGoogle,
  signOutFirebase,
} from './firebase'

export type {
  CreateFirebaseBackendOptions,
  FirebaseAuthSession,
  FirebaseAuthoritativeCommand,
  FirebaseBackend,
  FirebaseBackendDriver,
  FirebaseBackendSnapshot,
  FirebaseCollectionSnapshotRecord,
  FirebaseCollectionSpec,
  FirebaseCommandSuccess,
  FirebaseDocumentSnapshotRecord,
  FirebaseDraftPhase,
  FirebaseDraftStatus,
  FirebaseDraftWrite,
  FirebaseEventMembership,
  FirebaseSessionRole,
  BootstrapVibe26Result,
  FirebaseViewRole,
  ParticipantJoinRequest,
  ParticipantJoinResult,
  SaveAnswerDraftRequest,
  SavePrivateDraftRequest,
  SaveProjectDraftRequest,
  SaveSynthesisDraftRequest,
} from './firebase'
