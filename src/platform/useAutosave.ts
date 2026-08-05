import { useCallback, useEffect, useRef, useState } from 'react'

export type AutosavePhase =
  | 'idle'
  | 'saving'
  | 'pending'
  | 'saved'
  | 'offline'
  | 'stale'
  | 'conflict'
  | 'error'

export interface AutosaveSnapshot {
  phase: AutosavePhase
  savedAt: Date | null
  flush: () => Promise<boolean>
  markSaved: () => void
  markPhase: (phase: AutosavePhase) => void
}

interface UseAutosaveOptions {
  delay?: number
  enabled?: boolean
  fingerprint: string
  save: () => boolean | Promise<boolean>
  saveOnMount?: boolean
}

export function useAutosave({
  delay = 1_500,
  enabled = true,
  fingerprint,
  save,
  saveOnMount = false,
}: UseAutosaveOptions): AutosaveSnapshot {
  const saveRef = useRef(save)
  const enabledRef = useRef(enabled)
  const fingerprintRef = useRef(fingerprint)
  const initialSaveRequiredRef = useRef(enabled && saveOnMount)
  const versionRef = useRef(enabled && saveOnMount ? 1 : 0)
  const acknowledgedVersionRef = useRef(0)
  const inFlightRef = useRef<Promise<boolean> | null>(null)
  const [phase, setPhase] = useState<AutosavePhase>('idle')
  const [savedAt, setSavedAt] = useState<Date | null>(null)

  saveRef.current = save
  enabledRef.current = enabled

  const markSaved = useCallback(() => {
    acknowledgedVersionRef.current = versionRef.current
    setSavedAt(new Date())
    setPhase(navigator.onLine ? 'saved' : 'offline')
  }, [])

  const markPhase = useCallback((nextPhase: AutosavePhase) => {
    setPhase(nextPhase)
  }, [])

  const flush = useCallback(async () => {
    if (inFlightRef.current) return inFlightRef.current
    if (!enabledRef.current) {
      return acknowledgedVersionRef.current >= versionRef.current
    }
    if (acknowledgedVersionRef.current >= versionRef.current) {
      // A debounced flush may run after an in-flight save has already
      // acknowledged the same version. The fingerprint effect has marked the
      // UI as saving, so settle the visible state even though no write remains.
      setPhase(navigator.onLine ? 'saved' : 'offline')
      return true
    }

    const operation = (async () => {
      while (acknowledgedVersionRef.current < versionRef.current) {
        if (!enabledRef.current) return false
        const targetVersion = versionRef.current
        setPhase(navigator.onLine ? 'saving' : 'offline')
        try {
          const pending = saveRef.current()
          if (pending instanceof Promise) setPhase(navigator.onLine ? 'pending' : 'offline')
          const ok = await pending
          if (!ok) {
            setPhase(navigator.onLine ? 'error' : 'offline')
            return false
          }
          // A newer edit can arrive while this write is pending. Acknowledge
          // only the exact generation that reached the server, then loop once
          // more for the latest fingerprint instead of clearing all dirtiness.
          acknowledgedVersionRef.current = Math.max(
            acknowledgedVersionRef.current,
            targetVersion,
          )
        } catch {
          setPhase(navigator.onLine ? 'error' : 'offline')
          return false
        }
      }
      setSavedAt(new Date())
      setPhase(navigator.onLine ? 'saved' : 'offline')
      return true
    })()
    inFlightRef.current = operation
    try {
      return await operation
    } finally {
      if (inFlightRef.current === operation) inFlightRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!initialSaveRequiredRef.current) return
    setPhase('saving')
    const timeout = window.setTimeout(() => {
      initialSaveRequiredRef.current = false
      if (!enabledRef.current) return
      void flush()
    }, delay)
    return () => window.clearTimeout(timeout)
  }, [delay, flush])

  useEffect(() => {
    if (fingerprintRef.current === fingerprint) return
    fingerprintRef.current = fingerprint
    if (!enabled) return
    versionRef.current += 1
    setPhase('saving')
    const timeout = window.setTimeout(flush, delay)
    return () => window.clearTimeout(timeout)
  }, [delay, enabled, fingerprint, flush])

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') void flush()
    }
    const onOnline = () => setPhase((current) => current === 'offline' ? 'pending' : current)
    const onOffline = () => setPhase((current) => (
      current === 'saving' || current === 'pending' ? 'offline' : current
    ))
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      void flush()
    }
  }, [flush])

  return { phase, savedAt, flush, markSaved, markPhase }
}
