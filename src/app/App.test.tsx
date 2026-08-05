import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { RouterProvider } from './router'

vi.mock('../features/EbookPage', () => ({
  EbookPage: () => <h1>온라인 책자</h1>,
}))

vi.mock('../features/pages', () => ({
  AdminInviteAcceptPage: () => <p>관리자 초대</p>,
  DashboardPage: () => <p>대시보드</p>,
  EmbedDashboardPage: () => <p>임베드</p>,
  ExhibitionPage: () => <p>전시</p>,
  JoinPage: () => <p>입장</p>,
  LandingPage: () => <h1>VibeCoding 서비스</h1>,
  NotFoundPage: () => <p>찾을 수 없음</p>,
  OrganizerControlPage: () => <p>주최자</p>,
  OrganizerOperationsPage: () => <p>운영</p>,
  OrganizerSessionsPage: () => <p>세션</p>,
  ParticipantLivePage: () => <p>라이브</p>,
  SubmissionPage: () => <p>제출</p>,
  SynthesisPage: () => <p>정리</p>,
}))

function renderApp(pathname: string) {
  window.history.replaceState(null, '', pathname)
  return render(<RouterProvider><App /></RouterProvider>)
}

describe('application entry routes', () => {
  beforeEach(() => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('uses the root URL for the VibeCoding service', () => {
    renderApp('/')
    expect(screen.getByRole('heading', { name: 'VibeCoding 서비스' })).toBeInTheDocument()
  })

  it('keeps the standalone book only at /ebook', async () => {
    renderApp('/ebook')
    expect(await screen.findByRole('heading', { name: '온라인 책자' })).toBeInTheDocument()
  })

  it('redirects the previous /platform alias to the service root', async () => {
    renderApp('/platform')
    expect(await screen.findByRole('heading', { name: 'VibeCoding 서비스' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/')
  })
})
