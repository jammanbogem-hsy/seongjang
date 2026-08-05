import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlatformProvider, usePlatform } from '../app/PlatformProvider'
import { RouterProvider } from '../app/router'
import { createSeedState } from '../domain/seed'
import { PARTICIPANT_SESSION_KEY, PLATFORM_STORAGE_KEY } from '../platform/persistence'
import { ParticipantLivePage } from './pages'

function SlideHarness() {
  const { dispatch } = usePlatform()
  return (
    <div>
      <button onClick={() => dispatch({ type: 'SET_ACTIVE_SLIDE', slideIndex: 0 })} type="button">1단계로</button>
      <button onClick={() => dispatch({ type: 'SET_ACTIVE_SLIDE', slideIndex: 3 })} type="button">4단계로</button>
    </div>
  )
}

describe('participant answer draft state', () => {
  beforeEach(() => {
    const seed = createSeedState()
    seed.live.activeSlideIndex = 3
    seed.live.timer = {
      durationSec: seed.slides[3].durationSec,
      remainingSec: seed.slides[3].durationSec,
      status: 'idle',
      endsAt: null,
    }
    window.localStorage.setItem(PLATFORM_STORAGE_KEY, JSON.stringify(seed))
    window.sessionStorage.setItem(PARTICIPANT_SESSION_KEY, seed.participants[0].id)
    vi.stubGlobal('BroadcastChannel', undefined)
  })

  afterEach(() => {
    cleanup()
    window.localStorage.clear()
    window.sessionStorage.clear()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('preserves text across active slide changes and uses the canonical saved value', () => {
    render(
      <RouterProvider>
        <PlatformProvider>
          <ParticipantLivePage />
          <SlideHarness />
        </PlatformProvider>
      </RouterProvider>,
    )

    fireEvent.change(screen.getByLabelText('나의 개인 답변'), {
      target: { value: '  아직 제출하지 않은 중요한 초안  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: '1단계로' }))
    fireEvent.click(screen.getByRole('button', { name: '4단계로' }))

    expect(screen.getByLabelText('나의 개인 답변')).toHaveValue('  아직 제출하지 않은 중요한 초안  ')

    fireEvent.click(screen.getByRole('button', { name: '임시 저장' }))

    expect(screen.getByLabelText('나의 개인 답변')).toHaveValue('아직 제출하지 않은 중요한 초안')
  })

  it('disables the field, draft save and submission when time is complete', () => {
    const seed = JSON.parse(window.localStorage.getItem(PLATFORM_STORAGE_KEY)!)
    seed.live.timer = {
      ...seed.live.timer,
      remainingSec: 0,
      status: 'complete',
      endsAt: null,
    }
    window.localStorage.setItem(PLATFORM_STORAGE_KEY, JSON.stringify(seed))

    render(
      <RouterProvider>
        <PlatformProvider>
          <ParticipantLivePage />
        </PlatformProvider>
      </RouterProvider>,
    )

    expect(screen.getByLabelText('나의 개인 답변')).toBeDisabled()
    expect(screen.getByRole('button', { name: '임시 저장' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '개인 답변 제출' })).toBeDisabled()
  })

  it('autosaves a changed answer as a draft after the debounce window', () => {
    vi.useFakeTimers()
    render(
      <RouterProvider>
        <PlatformProvider>
          <ParticipantLivePage />
        </PlatformProvider>
      </RouterProvider>,
    )

    fireEvent.change(screen.getByLabelText('나의 개인 답변'), {
      target: { value: '자동 저장되는 새로운 단계 답변' },
    })
    act(() => vi.advanceTimersByTime(750))

    const persisted = JSON.parse(window.localStorage.getItem(PLATFORM_STORAGE_KEY)!)
    const saved = persisted.answers.find(
      (answer: { participantId: string; slideId: string }) =>
        answer.participantId === persisted.participants[0].id && answer.slideId === persisted.slides[3].id,
    )
    expect(saved).toMatchObject({ content: '자동 저장되는 새로운 단계 답변', status: 'draft' })
    expect(screen.getByText(/모든 변경사항 저장됨/)).toBeInTheDocument()
  })
})
