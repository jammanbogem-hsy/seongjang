import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { Link, Navigate, Route, RouterProvider, Routes, useParams } from './router'

function EventPage() {
  const { eventId } = useParams<{ eventId: string }>()
  return <h1>행사 {eventId}</h1>
}

describe('internal SPA router', () => {
  beforeEach(() => window.history.replaceState(null, '', '/'))

  it('navigates with Link and resolves route parameters', () => {
    render(
      <RouterProvider>
        <Link to="/events/room-vibe26">행사 열기</Link>
        <Routes>
          <Route element={<p>홈</p>} path="/" />
          <Route element={<EventPage />} path="/events/:eventId" />
        </Routes>
      </RouterProvider>,
    )

    fireEvent.click(screen.getByRole('link', { name: '행사 열기' }))
    expect(screen.getByRole('heading', { name: '행사 room-vibe26' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/events/room-vibe26')
  })

  it('supports declarative redirects', () => {
    window.history.replaceState(null, '', '/join')
    render(
      <RouterProvider>
        <Routes>
          <Route element={<Navigate replace to="/join/VIBE26" />} path="/join" />
          <Route element={<EventPage />} path="/join/:eventId" />
        </Routes>
      </RouterProvider>,
    )
    expect(screen.getByRole('heading', { name: '행사 VIBE26' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/join/VIBE26')
  })
})
