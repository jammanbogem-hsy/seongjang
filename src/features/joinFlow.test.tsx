import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlatformProvider } from '../app/PlatformProvider'
import { Route, RouterProvider, Routes } from '../app/router'
import { createSeedState } from '../domain/seed'
import { PARTICIPANT_SESSION_KEY, PLATFORM_STORAGE_KEY } from '../platform/persistence'
import { JoinPage } from './pages'

function renderJoin() {
  return render(
    <RouterProvider>
      <PlatformProvider>
        <Routes>
          <Route element={<JoinPage />} path="/join/:roomCode" />
          <Route element={<p>참여 화면 연결 완료</p>} path="/events/:eventId/live" />
        </Routes>
      </PlatformProvider>
    </RouterProvider>,
  )
}

describe('participant first entry and re-entry UI', () => {
  const seed = createSeedState()

  beforeEach(() => {
    seed.room.lifecycle = 'lobby'
    window.localStorage.setItem(PLATFORM_STORAGE_KEY, JSON.stringify(seed))
    window.sessionStorage.clear()
    window.history.replaceState(null, '', '/join/VIBE26?mode=reenter')
    vi.stubGlobal('BroadcastChannel', undefined)
  })

  afterEach(() => {
    cleanup()
    window.localStorage.clear()
    window.sessionStorage.clear()
    window.history.replaceState(null, '', '/')
    vi.unstubAllGlobals()
  })

  it('does not create a new participant from the re-entry form', async () => {
    const initialCount = seed.participants.length
    renderJoin()

    expect(screen.getByRole('button', { name: '다시 입장' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.change(screen.getByLabelText(/닉네임/), { target: { value: '등록되지 않은 이름' } })
    fireEvent.change(screen.getByLabelText(/기존 개인 입장코드 4자리/), { target: { value: '1234' } })
    fireEvent.click(screen.getByRole('button', { name: '이전 기록으로 다시 입장' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('등록된 닉네임을 찾지 못했어요')
    const persisted = JSON.parse(window.localStorage.getItem(PLATFORM_STORAGE_KEY)!)
    expect(persisted.participants).toHaveLength(initialCount)
  })

  it('restores the matching participant with the original nickname and code', async () => {
    const participant = seed.participants[0]
    renderJoin()

    fireEvent.change(screen.getByLabelText(/닉네임/), { target: { value: participant.nickname } })
    fireEvent.change(screen.getByLabelText(/기존 개인 입장코드 4자리/), { target: { value: participant.pin } })
    fireEvent.click(screen.getByRole('button', { name: '이전 기록으로 다시 입장' }))

    await waitFor(() => expect(screen.getByText('참여 화면 연결 완료')).toBeInTheDocument())
    expect(window.sessionStorage.getItem(PARTICIPANT_SESSION_KEY)).toBe(participant.id)
  })
})
