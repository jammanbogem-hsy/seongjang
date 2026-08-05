import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'

function readDraft<T>(key: string, fallback: T): T {
  if (!key || typeof window === 'undefined') return fallback
  try {
    const serialized = window.sessionStorage.getItem(key)
    return serialized ? JSON.parse(serialized) as T : fallback
  } catch {
    return fallback
  }
}

export function usePersistentDraft<T>(
  key: string,
  fallback: T,
): [T, Dispatch<SetStateAction<T>>, () => void] {
  const fallbackRef = useRef(fallback)
  const hydratedKeyRef = useRef(key)
  const [value, setValue] = useState<T>(() => readDraft(key, fallback))

  useEffect(() => {
    fallbackRef.current = fallback
  }, [fallback])

  useEffect(() => {
    hydratedKeyRef.current = ''
    setValue(readDraft(key, fallbackRef.current))
  }, [key])

  useEffect(() => {
    if (!key || typeof window === 'undefined') return
    if (hydratedKeyRef.current !== key) {
      hydratedKeyRef.current = key
      return
    }
    try {
      window.sessionStorage.setItem(key, JSON.stringify(value))
    } catch {
      // The domain autosave remains the fallback when browser draft storage is unavailable.
    }
  }, [key, value])

  const clear = useCallback(() => {
    if (key && typeof window !== 'undefined') window.sessionStorage.removeItem(key)
    setValue(fallbackRef.current)
  }, [key])

  return [value, setValue, clear]
}
