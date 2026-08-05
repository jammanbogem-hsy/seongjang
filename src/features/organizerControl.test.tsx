import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlatformProvider } from '../app/PlatformProvider'
import { RouterProvider } from '../app/router'
import { PLATFORM_STORAGE_KEY } from '../platform/persistence'
import { OrganizerControlPage } from './pages'

describe('organizer live controls', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/admin/events/room-vibe26/control')
    window.localStorage.clear()
    window.sessionStorage.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('adjusts the active timer and autosaves slide edits', async () => {
    render(
      <RouterProvider>
        <PlatformProvider>
          <OrganizerControlPage />
        </PlatformProvider>
      </RouterProvider>,
    )

    const duration = screen.getByRole('spinbutton', { name: '현재 단계 시간 (분)' })
    fireEvent.change(duration, { target: { value: '15' } })
    fireEvent.click(screen.getByRole('button', { name: '시간 적용' }))
    expect(screen.getByText('15분 · 답변 0개')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '슬라이드 편집' }))
    const title = screen.getByRole('textbox', { name: '슬라이드 제목' })
    fireEvent.change(title, { target: { value: '참여자와 함께 고친 질문' } })

    await act(async () => {
      vi.advanceTimersByTime(950)
      await Promise.resolve()
    })

    expect(screen.getByRole('heading', { name: '참여자와 함께 고친 질문' })).toBeInTheDocument()
    expect(window.localStorage.getItem(PLATFORM_STORAGE_KEY)).toContain('참여자와 함께 고친 질문')
  })
})
