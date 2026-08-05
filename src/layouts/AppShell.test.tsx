import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RouterProvider } from '../app/router'
import { AppShell, type AppNavItem } from './AppShell'

const navItems: AppNavItem[] = [
  { label: '라이브', to: '/live', icon: 'cast' },
  { label: '참여자', to: '/people', icon: 'group' },
]

function renderShell(mode: 'organizer' | 'participant') {
  return render(
    <RouterProvider>
      <AppShell mode={mode} navItems={navItems} roomCode="VIBE26">
        <main id="main-content">작업 영역</main>
      </AppShell>
    </RouterProvider>,
  )
}

describe('AppShell navigation', () => {
  beforeEach(() => window.history.replaceState(null, '', '/live'))
  afterEach(cleanup)

  it('gives organizers a desktop workspace rail and a mobile navigation', () => {
    renderShell('organizer')

    const rail = screen.getByRole('navigation', { name: '주최자 주요 메뉴' })
    expect(within(rail).getByRole('link', { name: '라이브' })).toHaveClass('app-shell__nav-link--active')
    expect(screen.getByRole('navigation', { name: '모바일 주요 메뉴' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: '주요 메뉴' })).not.toBeInTheDocument()
  })

  it('keeps participant navigation in the top bar', () => {
    renderShell('participant')

    expect(screen.getByRole('navigation', { name: '주요 메뉴' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: '주최자 주요 메뉴' })).not.toBeInTheDocument()
  })
})
