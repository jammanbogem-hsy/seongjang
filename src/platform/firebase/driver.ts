import type { User } from 'firebase/auth'
import {
  collection,
  doc,
  limit as queryLimit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  type DocumentData,
  type QueryConstraint,
  type Unsubscribe,
  type WhereFilterOp,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { getFirebaseServices, type FirebaseServices } from './config'

export interface FirebaseDocumentRecord {
  fromCache?: boolean
  hasPendingWrites?: boolean
  id: string
  data: Record<string, unknown>
}

export interface FirebaseSnapshotMetadata {
  fromCache: boolean
  hasPendingWrites: boolean
}

export interface FirebaseDocumentSnapshotRecord extends FirebaseSnapshotMetadata {
  document: FirebaseDocumentRecord | null
}

export interface FirebaseCollectionSnapshotRecord extends FirebaseSnapshotMetadata {
  documents: FirebaseDocumentRecord[]
}

export interface FirebaseWhereConstraint {
  field: string
  op: WhereFilterOp
  value: unknown
}

export interface FirebaseOrderConstraint {
  direction?: 'asc' | 'desc'
  field: string
}

export interface FirebaseCollectionSpec {
  limit?: number
  path: string
  order?: FirebaseOrderConstraint[]
  where?: FirebaseWhereConstraint[]
}

export interface FirebaseBackendDriver {
  currentUser: () => User | null
  invoke: <TResult>(name: string, payload: unknown) => Promise<TResult>
  serverTimestamp: () => unknown
  setDocument: (path: string, data: Record<string, unknown>) => Promise<void>
  watchCollection: (
    spec: FirebaseCollectionSpec,
    next: (snapshot: FirebaseCollectionSnapshotRecord) => void,
    error: (cause: Error) => void,
  ) => Unsubscribe
  watchDocument: (
    path: string,
    next: (snapshot: FirebaseDocumentSnapshotRecord) => void,
    error: (cause: Error) => void,
  ) => Unsubscribe
}

function record(
  id: string,
  data: DocumentData,
  metadata?: FirebaseSnapshotMetadata,
): FirebaseDocumentRecord {
  return { id, data: data as Record<string, unknown>, ...metadata }
}

export function createFirebaseSdkDriver(
  services: FirebaseServices = getFirebaseServices(),
): FirebaseBackendDriver {
  return {
    currentUser: () => services.auth.currentUser,
    invoke: async <TResult,>(name: string, payload: unknown) => {
      const callable = httpsCallable<unknown, TResult>(services.functions, name)
      return (await callable(payload)).data
    },
    serverTimestamp,
    setDocument: async (path, data) => {
      await setDoc(doc(services.db, path), data, { merge: true })
    },
    watchCollection: (spec, next, error) => {
      const constraints: QueryConstraint[] = []
      spec.where?.forEach((constraint) => {
        constraints.push(where(constraint.field, constraint.op, constraint.value))
      })
      spec.order?.forEach((constraint) => {
        constraints.push(orderBy(constraint.field, constraint.direction))
      })
      if (spec.limit && Number.isInteger(spec.limit) && spec.limit > 0) {
        constraints.push(queryLimit(spec.limit))
      }
      const source = query(collection(services.db, spec.path), ...constraints)
      return onSnapshot(
        source,
        { includeMetadataChanges: true },
        (snapshot) => next({
          documents: snapshot.docs.map((item) => record(item.id, item.data(), {
            fromCache: item.metadata.fromCache,
            hasPendingWrites: item.metadata.hasPendingWrites,
          })),
          fromCache: snapshot.metadata.fromCache,
          hasPendingWrites: snapshot.metadata.hasPendingWrites,
        }),
        (cause) => error(cause),
      )
    },
    watchDocument: (path, next, error) => onSnapshot(
      doc(services.db, path),
      { includeMetadataChanges: true },
      (snapshot) => next({
        document: snapshot.exists() ? record(snapshot.id, snapshot.data(), {
          fromCache: snapshot.metadata.fromCache,
          hasPendingWrites: snapshot.metadata.hasPendingWrites,
        }) : null,
        fromCache: snapshot.metadata.fromCache,
        hasPendingWrites: snapshot.metadata.hasPendingWrites,
      }),
      (cause) => error(cause),
    ),
  }
}
