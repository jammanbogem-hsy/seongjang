import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlatformProvider } from '../app/PlatformProvider'
import { RouterProvider } from '../app/router'
import { createSeedState } from '../domain/seed'
import { PLATFORM_STORAGE_KEY } from '../platform/persistence'
import { ExhibitionPage } from './pages'

describe('public exhibition', () => {
  beforeEach(() => {
    const seed = createSeedState()
    window.localStorage.setItem(PLATFORM_STORAGE_KEY, JSON.stringify(seed))
    window.history.replaceState(null, '', '/exhibitions/vibecoding-2026')
    vi.stubGlobal('BroadcastChannel', undefined)
  })

  afterEach(() => {
    cleanup()
    window.localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('opens a full project story from the whole exhibition card', () => {
    const seed = createSeedState()
    const project = seed.publishedSnapshot!.data.projects[0]
    render(
      <RouterProvider>
        <PlatformProvider>
          <ExhibitionPage />
        </PlatformProvider>
      </RouterProvider>,
    )

    fireEvent.click(screen.getByRole('button', {
      name: `${project.title} 상세 보기`,
    }))

    expect(screen.getByRole('dialog', { name: project.title })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '작품의 핵심' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '만든 사람의 기록' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '작품의 특징' })).toBeInTheDocument()
    expect(window.location.pathname).toContain(project.key)
  })
})
