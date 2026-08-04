import { StrictMode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlatformProvider, usePlatform } from './PlatformProvider'

function TimerHarness() {
  const { dispatch, timerView } = usePlatform()
  return (
    <>
      <output aria-label="남은 시간">{timerView.remainingSec}</output>
      <button onClick={() => dispatch({ type: 'START_TIMER' })} type="button">시작</button>
    </>
  )
}

class MockBroadcastChannel {
  static instances = new Set<MockBroadcastChannel>()
  private listeners = new Set<(event: MessageEvent<unknown>) => void>()

  constructor(public readonly name: string) {
    MockBroadcastChannel.instances.add(this)
  }

  static reset() {
    MockBroadcastChannel.instances.clear()
  }

  addEventListener(_type: string, listener: (event: MessageEvent<unknown>) => void) {
    this.listeners.add(listener)
  }

  removeEventListener(_type: string, listener: (event: MessageEvent<unknown>) => void) {
    this.listeners.delete(listener)
  }

  postMessage(data: unknown) {
    MockBroadcastChannel.instances.forEach((instance) => {
      instance.listeners.forEach((listener) => listener({ data } as MessageEvent<unknown>))
    })
  }

  close() {
    MockBroadcastChannel.instances.delete(this)
    this.listeners.clear()
  }
}

function SyncHarness({ id, control = false }: { id: string; control?: boolean }) {
  const { dispatch, currentSlide, state } = usePlatform()
  return (
    <>
      <output aria-label={`${id} 현재 단계`}>{currentSlide.order}</output>
      {control ? (
        <button onClick={() => dispatch({ type: 'SET_ACTIVE_SLIDE', slideIndex: Math.min(state.live.activeSlideIndex + 1, state.slides.length - 1) })} type="button">
          다음 단계
        </button>
      ) : null}
    </>
  )
}

describe('PlatformProvider live clock', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    MockBroadcastChannel.reset()
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel)
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-05T01:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('publishes a new timer view to consumers every second while running', () => {
    render(<PlatformProvider><TimerHarness /></PlatformProvider>)
    expect(screen.getByLabelText('남은 시간')).toHaveTextContent('642')
    fireEvent.click(screen.getByRole('button', { name: '시작' }))

    act(() => vi.advanceTimersByTime(2_000))
    expect(screen.getByLabelText('남은 시간')).toHaveTextContent('640')
  })

  it('synchronizes live slide revisions between tabs and survives strict effect replay', () => {
    render(
      <StrictMode>
        <PlatformProvider><SyncHarness control id="주최자" /></PlatformProvider>
        <PlatformProvider><SyncHarness id="참여자" /></PlatformProvider>
      </StrictMode>,
    )
    expect(screen.getByLabelText('참여자 현재 단계')).toHaveTextContent('3')
    fireEvent.click(screen.getByRole('button', { name: '다음 단계' }))
    expect(screen.getByLabelText('주최자 현재 단계')).toHaveTextContent('4')
    expect(screen.getByLabelText('참여자 현재 단계')).toHaveTextContent('4')
  })
})
