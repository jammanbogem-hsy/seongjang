import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlatformContextValue } from '../app/PlatformProvider'
import { RouterProvider } from '../app/router'
import type { CommandResult, PrototypeState } from '../domain/models'
import { createSeedState } from '../domain/seed'
import { SynthesisPage } from './pages'

const platformSlot = vi.hoisted(() => ({
  current: null as PlatformContextValue | null,
}))

vi.mock('../app/PlatformProvider', async () => {
  const actual = await vi.importActual<typeof import('../app/PlatformProvider')>('../app/PlatformProvider')
  return {
    ...actual,
    usePlatform: () => {
      if (!platformSlot.current) throw new Error('테스트 플랫폼이 준비되지 않았습니다.')
      return platformSlot.current
    },
  }
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

function platformValue(
  state: PrototypeState,
  dispatchAsync: PlatformContextValue['dispatchAsync'],
): PlatformContextValue {
  return {
    authEmail: 'owner@example.com',
    authRole: 'owner',
    backendError: null,
    backendPhase: 'ready',
    currentParticipant: null,
    currentSlide: state.slides[state.live.activeSlideIndex],
    dispatch: <T,>() => ({ ok: true, value: undefined as T }),
    dispatchAsync,
    joinParticipant: async () => ({ ok: false, error: { code: 'NOT_ALLOWED', message: 'unused' } }),
    revealParticipantPin: async () => ({ ok: false, error: { code: 'NOT_ALLOWED', message: 'unused' } }),
    savePrivateDraft: async () => true,
    selectedParticipantId: null,
    selectParticipant: () => undefined,
    signInOrganizer: async () => ({ ok: true, value: undefined }),
    signOut: async () => undefined,
    state,
    timerView: { progress: 0, remainingSec: 0, status: 'idle' },
  }
}

describe('synthesis concurrency recovery', () => {
  afterEach(() => {
    cleanup()
    platformSlot.current = null
    window.localStorage.clear()
  })

  it('uses the latest Firestore revision after an in-flight organizer conflict', async () => {
    const initial = createSeedState()
    initial.synthesis.revision = 10
    const firstWrite = deferred<CommandResult<{ revision: number }>>()
    const dispatch = vi.fn()
      .mockImplementationOnce(() => firstWrite.promise)
      .mockResolvedValue({ ok: true, value: { revision: 12 }, notice: '저장됨' })
    platformSlot.current = platformValue(
      initial,
      dispatch as unknown as PlatformContextValue['dispatchAsync'],
    )

    const view = render(
      <RouterProvider>
        <SynthesisPage />
      </RouterProvider>,
    )
    const firstTheme = screen.getByText('모든 목소리').closest('button')
    expect(firstTheme).not.toBeNull()
    fireEvent.click(firstTheme!)

    const remote = {
      ...initial,
      synthesis: {
        ...initial.synthesis,
        revision: 11,
      },
    }
    platformSlot.current = platformValue(
      remote,
      dispatch as unknown as PlatformContextValue['dispatchAsync'],
    )
    view.rerender(
      <RouterProvider>
        <SynthesisPage />
      </RouterProvider>,
    )

    await act(async () => {
      firstWrite.resolve({
        ok: false,
        error: { code: 'NOT_ALLOWED', message: '최신 내용을 확인해주세요.' },
      })
      await firstWrite.promise
    })

    const secondTheme = screen.getByText('이어지는 기록').closest('button')
    expect(secondTheme).not.toBeNull()
    fireEvent.click(secondTheme!)

    await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(2))
    expect(dispatch.mock.calls[1][0]).toMatchObject({
      input: { expectedRevision: 11 },
      type: 'UPDATE_SYNTHESIS',
    })
  })

  it('can publish the accepted server selection after a selection conflict', async () => {
    const initial = createSeedState()
    initial.synthesis.revision = 10
    const firstWrite = deferred<CommandResult<{ revision: number }>>()
    const dispatch = vi.fn()
      .mockImplementationOnce(() => firstWrite.promise)
      .mockResolvedValue({ ok: true, value: { revision: 12 }, notice: '발행됨' })
    platformSlot.current = platformValue(
      initial,
      dispatch as unknown as PlatformContextValue['dispatchAsync'],
    )

    const view = render(
      <RouterProvider>
        <SynthesisPage />
      </RouterProvider>,
    )
    const firstTheme = screen.getByText('모든 목소리').closest('button')
    expect(firstTheme).not.toBeNull()
    fireEvent.click(firstTheme!)

    const remote = {
      ...initial,
      synthesis: {
        ...initial.synthesis,
        revision: 11,
      },
    }
    platformSlot.current = platformValue(
      remote,
      dispatch as unknown as PlatformContextValue['dispatchAsync'],
    )
    view.rerender(
      <RouterProvider>
        <SynthesisPage />
      </RouterProvider>,
    )

    await act(async () => {
      firstWrite.resolve({
        ok: false,
        error: { code: 'NOT_ALLOWED', message: '최신 내용을 확인해주세요.' },
      })
      await firstWrite.promise
    })

    fireEvent.click(screen.getAllByRole('button', { name: '새 리비전 발행' })[0])

    await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(2))
    expect(dispatch.mock.calls[1][0]).toEqual({ type: 'PUBLISH_SYNTHESIS' })
  })
})
