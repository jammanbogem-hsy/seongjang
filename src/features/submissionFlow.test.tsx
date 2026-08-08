import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlatformProvider } from '../app/PlatformProvider'
import { RouterProvider } from '../app/router'
import { createSeedState } from '../domain/seed'
import { PARTICIPANT_SESSION_KEY, PLATFORM_STORAGE_KEY } from '../platform/persistence'
import { SubmissionPage } from './pages'

describe('participant exhibition post', () => {
  beforeEach(() => {
    const seed = createSeedState()
    const participant = seed.participants.at(-1)!
    seed.submissions = seed.submissions.filter((submission) => submission.participantId !== participant.id)
    window.localStorage.setItem(PLATFORM_STORAGE_KEY, JSON.stringify(seed))
    window.sessionStorage.setItem(PARTICIPANT_SESSION_KEY, participant.id)
    window.history.replaceState(null, '', '/events/room-vibe26/submission')
    vi.stubGlobal('BroadcastChannel', undefined)
  })

  afterEach(() => {
    cleanup()
    window.localStorage.clear()
    window.sessionStorage.clear()
    vi.unstubAllGlobals()
  })

  it('builds and submits a Padlet-style exhibition card with a selected cover', async () => {
    render(
      <RouterProvider>
        <PlatformProvider>
          <SubmissionPage />
        </PlatformProvider>
      </RouterProvider>,
    )

    expect(screen.getByRole('heading', { name: '나의 전시 게시물' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '전시 고양이 표지' }))
    fireEvent.change(screen.getByRole('textbox', { name: '작품명' }), { target: { value: '우리의 아이디어 보드' } })
    fireEvent.change(screen.getByRole('textbox', { name: '한 줄 소개' }), { target: { value: '아이디어를 한곳에서 발견하는 게시판' } })
    fireEvent.change(screen.getByRole('textbox', { name: '작품 이야기' }), { target: { value: '각자의 아이디어를 카드로 공유하고 서로 댓글을 남깁니다.' } })
    fireEvent.change(screen.getByRole('textbox', { name: '작품 링크' }), { target: { value: 'https://example.com/idea-board' } })
    fireEvent.change(screen.getByRole('textbox', { name: '기술·주제 태그' }), { target: { value: 'Firebase, 아이디어, 교육' } })
    fireEvent.change(screen.getByRole('textbox', { name: '제작 회고' }), { target: { value: '작은 공유가 다음 실험을 만든다는 것을 배웠습니다.' } })

    expect(screen.getByText('게시물 준비 4 / 4')).toBeInTheDocument()
    expect(screen.getByAltText('전시 카드 대표 이미지')).toHaveAttribute('src', '/assets/illustrations/cat-exhibition.webp')
    fireEvent.click(screen.getByRole('button', { name: '전시용 게시물 제출' }))
    await act(async () => { await Promise.resolve() })

    expect(screen.getAllByText('제출 완료 · 주최자 공개 대기')).toHaveLength(2)
    const persisted = JSON.parse(window.localStorage.getItem(PLATFORM_STORAGE_KEY)!)
    expect(persisted.submissions.at(-1)).toMatchObject({
      coverImage: '/assets/illustrations/cat-exhibition.webp',
      demoUrl: 'https://example.com/idea-board',
      status: 'submitted',
      tags: ['Firebase', '아이디어', '교육'],
      title: '우리의 아이디어 보드',
    })
  })
})
