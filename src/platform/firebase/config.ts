import { getApp, getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app'
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check'
import {
  browserPopupRedirectResolver,
  browserSessionPersistence,
  connectAuthEmulator,
  getAuth,
  initializeAuth,
  type Auth,
} from 'firebase/auth'
import {
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  type Firestore,
} from 'firebase/firestore'
import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions'

export const VIBECODING_FIREBASE_CONFIG: FirebaseOptions = Object.freeze({
  apiKey: 'AIzaSyDFwSrlT73XS6JnSRM2GaiaG1KN_-Pnhv4',
  appId: '1:221777482604:web:608ba46b5d66bfea021949',
  authDomain: 'vibecoding-a3ada.firebaseapp.com',
  messagingSenderId: '221777482604',
  projectId: 'vibecoding-a3ada',
})

export const VIBECODING_AUTH_DEPENDENCIES = Object.freeze({
  persistence: browserSessionPersistence,
  popupRedirectResolver: browserPopupRedirectResolver,
})

const APP_NAME = 'vibecoding-web'
const APP_CHECK_SITE_KEY = '6LdSQ3YtAAAAAHLcBU-4dhrmrSgbu8d2LGX_IsPg'
const LOCAL_FIREBASE_CONFIG: FirebaseOptions = Object.freeze({
  apiKey: 'demo-vibecoding-local',
  appId: '1:123456789:web:local-vibecoding',
  authDomain: 'localhost',
  messagingSenderId: '123456789',
  projectId: 'demo-vibecoding-local',
})
const USE_FIREBASE_EMULATORS = import.meta.env.DEV
  || import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true'
  || (typeof window !== 'undefined' && ['127.0.0.1', 'localhost'].includes(window.location.hostname))

export interface FirebaseServices {
  app: FirebaseApp
  auth: Auth
  db: Firestore
  functions: Functions
}

let services: FirebaseServices | null = null
let appCheckInitialized = false
let emulatorsConnected = false

function activateAppCheck(app: FirebaseApp): void {
  if (appCheckInitialized) return
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  })
  appCheckInitialized = true
}

function firebaseApp(): FirebaseApp {
  const existing = getApps().find((candidate) => candidate.name === APP_NAME)
  if (existing) return getApp(APP_NAME)
  return initializeApp(USE_FIREBASE_EMULATORS ? LOCAL_FIREBASE_CONFIG : VIBECODING_FIREBASE_CONFIG, APP_NAME)
}

function firestore(app: FirebaseApp): Firestore {
  try {
    return initializeFirestore(app, {
      // Private participant and organizer documents must not survive a shared
      // browser session. Draft resilience is handled by scoped autosaves.
      localCache: memoryLocalCache(),
    })
  } catch {
    // Hot reload or another integration may have initialized the named app first.
    // Falling back to its existing Firestore instance is not a data-backend fallback.
    return getFirestore(app)
  }
}

function sessionAuth(app: FirebaseApp): Auth {
  try {
    return initializeAuth(app, VIBECODING_AUTH_DEPENDENCIES)
  } catch {
    return getAuth(app)
  }
}

function connectDevelopmentEmulators(next: FirebaseServices): void {
  if (!USE_FIREBASE_EMULATORS || emulatorsConnected) return
  connectAuthEmulator(next.auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(next.db, '127.0.0.1', 8080)
  connectFunctionsEmulator(next.functions, '127.0.0.1', 5001)
  emulatorsConnected = true
}

export function getFirebaseServices(): FirebaseServices {
  if (services) return services
  const app = firebaseApp()
  if (!USE_FIREBASE_EMULATORS) activateAppCheck(app)
  const functionsRegion = import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION?.trim() || 'asia-northeast3'
  services = {
    app,
    auth: sessionAuth(app),
    db: firestore(app),
    functions: getFunctions(app, functionsRegion),
  }
  connectDevelopmentEmulators(services)
  return services
}

/** Test-only injection seam. Production callers should never replace these services. */
export function setFirebaseServicesForTest(next: FirebaseServices | null): void {
  if (!import.meta.env.DEV && !import.meta.env.MODE.startsWith('test')) {
    throw new Error('Firebase service injection is restricted to development and tests.')
  }
  services = next
}
