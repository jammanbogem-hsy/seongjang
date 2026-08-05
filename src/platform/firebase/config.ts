import { getApp, getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app'
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check'
import { getAuth, type Auth } from 'firebase/auth'
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore'
import { getFunctions, type Functions } from 'firebase/functions'

export const VIBECODING_FIREBASE_CONFIG: FirebaseOptions = Object.freeze({
  apiKey: 'AIzaSyDFwSrlT73XS6JnSRM2GaiaG1KN_-Pnhv4',
  appId: '1:221777482604:web:608ba46b5d66bfea021949',
  authDomain: 'vibecoding-a3ada.firebaseapp.com',
  messagingSenderId: '221777482604',
  projectId: 'vibecoding-a3ada',
})

const APP_NAME = 'vibecoding-web'
const APP_CHECK_SITE_KEY = '6LdSQ3YtAAAAAHLcBU-4dhrmrSgbu8d2LGX_IsPg'

export interface FirebaseServices {
  app: FirebaseApp
  auth: Auth
  db: Firestore
  functions: Functions
}

let services: FirebaseServices | null = null
let appCheckInitialized = false

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
  return initializeApp(VIBECODING_FIREBASE_CONFIG, APP_NAME)
}

function firestore(app: FirebaseApp): Firestore {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    })
  } catch {
    // Hot reload or another integration may have initialized the named app first.
    // Falling back to its existing Firestore instance is not a data-backend fallback.
    return getFirestore(app)
  }
}

export function getFirebaseServices(): FirebaseServices {
  if (services) return services
  const app = firebaseApp()
  activateAppCheck(app)
  const functionsRegion = import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION?.trim() || 'asia-northeast3'
  services = {
    app,
    auth: getAuth(app),
    db: firestore(app),
    functions: getFunctions(app, functionsRegion),
  }
  return services
}

/** Test-only injection seam. Production callers should never replace these services. */
export function setFirebaseServicesForTest(next: FirebaseServices | null): void {
  if (!import.meta.env.DEV && !import.meta.env.MODE.startsWith('test')) {
    throw new Error('Firebase service injection is restricted to development and tests.')
  }
  services = next
}
