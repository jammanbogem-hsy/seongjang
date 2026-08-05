import { useCallback, useEffect, useRef, useState } from 'react'

export type AutosavePhase = 'idle' | 'saving' | 'saved' | 'offline' | 'error'

export interface AutosaveSnapshot {
  phase: AutosavePhase
  savedAt: Date | null
  flush: () => boolean
  markSaved: () => void
}

interface UseAutosaveOptions {
  delay?: number
  enabled?: boolean
  fingerprint: string
  save: () => boolean
}

export function useAutosave({
  delay = 700,
  enabled = true,
  fingerprint,
  save,
}: UseAutosaveOptions): AutosaveSnapshot {
  const saveRef = useRef(save)
  const fingerprintRef = useRef(fingerprint)
  const dirtyRef = useRef(false)
  const [phase, setPhase] = useState<AutosavePhase>('idle')
  const [savedAt, setSavedAt] = useState<Date | null>(null)

  saveRef.current = save

  const markSaved = useCallback(() => {
    dirtyRef.current = false
    setSavedAt(new Date())
    setPhase(navigator.onLine ? 'saved' : 'offline')
  }, [])

  const flush = useCallback(() => {
    if (!dirtyRef.current) return true
    setPhase('saving')
    const ok = saveRef.current()
    if (ok) {
      dirtyRef.current = false
      setSavedAt(new Date())
      setPhase(navigator.onLine ? 'saved' : 'offline')
      return true
    }
    setPhase('error')
    return false
  }, [])

  useEffect(() => {
    if (fingerprintRef.current === fingerprint) return
    fingerprintRef.current = fingerprint
    if (!enabled) return
    dirtyRef.current = true
    setPhase('saving')
    const timeout = window.setTimeout(flush, delay)
    return () => window.clearTimeout(timeout)
  }, [delay, enabled, fingerprint, flush])

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    const onOnline = () => setPhase((current) => current === 'offline' ? 'saved' : current)
    const onOffline = () => setPhase((current) => current === 'saved' ? 'offline' : current)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      flush()
    }
  }, [flush])

  return { phase, savedAt, flush, markSaved }
}
