import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useAutosave } from './useAutosave'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

describe('useAutosave generations', () => {
  it('persists a restored local draft without requiring another edit', async () => {
    vi.useFakeTimers()
    const save = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useAutosave({
      delay: 10,
      enabled: true,
      fingerprint: 'restored-local-draft',
      save,
      saveOnMount: true,
    }))

    await act(async () => { await vi.advanceTimersByTimeAsync(10) })

    expect(save).toHaveBeenCalledTimes(1)
    expect(result.current.phase).toBe('saved')
    vi.useRealTimers()
  })

  it('cancels a restored-draft save when conflict protection disables autosave', async () => {
    vi.useFakeTimers()
    const save = vi.fn().mockResolvedValue(true)
    const { result, rerender } = renderHook(
      ({ enabled }) => useAutosave({
        delay: 10,
        enabled,
        fingerprint: 'restored-local-draft',
        save,
        saveOnMount: true,
      }),
      { initialProps: { enabled: true } },
    )

    rerender({ enabled: false })
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })

    expect(save).not.toHaveBeenCalled()
    await expect(result.current.flush()).resolves.toBe(false)
    vi.useRealTimers()
  })

  it('serially saves an edit that arrives while the previous write is pending', async () => {
    vi.useFakeTimers()
    const first = deferred<boolean>()
    const second = deferred<boolean>()
    const save = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const { result, rerender } = renderHook(
      ({ fingerprint }) => useAutosave({ delay: 10, fingerprint, save }),
      { initialProps: { fingerprint: 'initial' } },
    )

    rerender({ fingerprint: 'edit-a' })
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    expect(save).toHaveBeenCalledTimes(1)

    rerender({ fingerprint: 'edit-b' })
    await act(async () => { first.resolve(true); await first.promise })
    expect(save).toHaveBeenCalledTimes(2)
    expect(result.current.phase).toBe('pending')

    await act(async () => { second.resolve(true); await second.promise })
    expect(result.current.phase).toBe('saved')
    vi.useRealTimers()
  })
})
