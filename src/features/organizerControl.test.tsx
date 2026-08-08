import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlatformProvider, usePlatform } from '../app/PlatformProvider'
import { RouterProvider } from '../app/router'
import { createSeedState } from '../domain/seed'
import { PARTICIPANT_SESSION_KEY, PLATFORM_STORAGE_KEY } from '../platform/persistence'
import { OrganizerControlPage, ParticipantLivePage } from './pages'

function SessionStartHarness() {
  const { dispatch } = usePlatform()
  return (
    <button onClick={() => dispatch({ type: 'START_SESSION' })} type="button">세션 시작 신호</button>
  )
}

describe('organizer live controls', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/admin/events/room-vibe26/control')
    window.localStorage.clear()
    window.sessionStorage.clear()
    vi.stubGlobal('BroadcastChannel', undefined)
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
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

  it('adds a new slide without changing the participant live page', async () => {
    render(
      <RouterProvider>
        <PlatformProvider>
          <OrganizerControlPage />
        </PlatformProvider>
      </RouterProvider>,
    )

    const liveTitle = '오늘 우리가 풀고 싶은 장면은?'
    expect(screen.getByRole('heading', { name: liveTitle })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '새 슬라이드' }))
    fireEvent.change(screen.getByRole('textbox', { name: '슬라이드 제목' }), {
      target: { value: '참여자 질문 추가 테스트' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: '참여자 질문' }), {
      target: { value: '새 질문에 각자의 답을 적어주세요.' },
    })
    fireEvent.click(screen.getByRole('button', { name: '슬라이드 추가' }))

    await act(async () => { await Promise.resolve() })
    expect(screen.getByText('참여자 질문 추가 테스트')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: liveTitle })).toBeInTheDocument()
    expect(window.localStorage.getItem(PLATFORM_STORAGE_KEY)).toContain('참여자 질문 추가 테스트')
  })

  it('reorders slide thumbnails through drag and drop', async () => {
    render(
      <RouterProvider>
        <PlatformProvider>
          <OrganizerControlPage />
        </PlatformProvider>
      </RouterProvider>,
    )

    const firstCanvas = screen.getByRole('button', { name: /1페이지 오늘 우리가 풀고 싶은 장면은/ })
    const secondCanvas = screen.getByRole('button', { name: /2페이지 가장 먼저 도울 사용자는/ })
    const firstCard = firstCanvas.closest('article')!
    const secondCard = secondCanvas.closest('article')!
    const dataTransfer = { effectAllowed: 'none' }
    fireEvent.dragStart(firstCard, { dataTransfer })
    fireEvent.dragOver(secondCard, { dataTransfer })
    fireEvent.drop(secondCard, { dataTransfer })

    await act(async () => { await Promise.resolve() })
    const stored = window.localStorage.getItem(PLATFORM_STORAGE_KEY) ?? ''
    expect(stored.indexOf('stage-empathy')).toBeLessThan(stored.indexOf('stage-discover'))
  })

  it('starts a lobby from the large organizer CTA', async () => {
    const seed = createSeedState()
    seed.room.lifecycle = 'lobby'
    seed.live.activeSlideIndex = 2
    seed.live.startedAt = null
    seed.live.timer = {
      durationSec: seed.slides[2].durationSec,
      remainingSec: seed.slides[2].durationSec,
      status: 'idle',
      endsAt: null,
    }
    window.localStorage.setItem(PLATFORM_STORAGE_KEY, JSON.stringify(seed))

    render(
      <RouterProvider>
        <PlatformProvider>
          <OrganizerControlPage />
        </PlatformProvider>
      </RouterProvider>,
    )

    expect(screen.getByText('24명 입장')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '세션 시작' }))
    await act(async () => { await Promise.resolve() })

    expect(screen.queryByRole('button', { name: '세션 시작' })).not.toBeInTheDocument()
    const persisted = JSON.parse(window.localStorage.getItem(PLATFORM_STORAGE_KEY)!)
    expect(persisted.room.lifecycle).toBe('live')
    expect(persisted.live.activeSlideIndex).toBe(0)
  })

  it('shows the dynamic session code and participant entry link from the route', () => {
    window.history.replaceState(null, '', '/admin/events/session-ab12cd/control')

    render(
      <RouterProvider>
        <PlatformProvider>
          <OrganizerControlPage />
        </PlatformProvider>
      </RouterProvider>,
    )

    expect(screen.getAllByText('AB12CD')).toHaveLength(2)
    expect(screen.getByRole('link', { name: 'http://localhost:3000/join/AB12CD' })).toHaveAttribute(
      'href',
      'http://localhost:3000/join/AB12CD',
    )
  })

  it('opens the first slide when a waiting participant receives the start signal', async () => {
    const seed = createSeedState()
    seed.room.lifecycle = 'lobby'
    seed.live.activeSlideIndex = 2
    seed.live.startedAt = null
    window.localStorage.setItem(PLATFORM_STORAGE_KEY, JSON.stringify(seed))
    window.sessionStorage.setItem(PARTICIPANT_SESSION_KEY, seed.participants[0].id)

    render(
      <RouterProvider>
        <PlatformProvider>
          <ParticipantLivePage />
          <SessionStartHarness />
        </PlatformProvider>
      </RouterProvider>,
    )

    expect(screen.getByRole('heading', { name: '세션 시작을 기다리고 있어요' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '세션 시작 신호' }))

    expect(screen.queryByRole('heading', { name: '세션 시작을 기다리고 있어요' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: seed.slides[0].title })).toBeInTheDocument()
  })

  it('closes the participant interaction screen when the organizer ends the session', () => {
    const seed = createSeedState()
    seed.room.lifecycle = 'ended'
    seed.live.timer = {
      ...seed.live.timer,
      remainingSec: 0,
      status: 'complete',
      endsAt: null,
    }
    window.localStorage.setItem(PLATFORM_STORAGE_KEY, JSON.stringify(seed))
    window.sessionStorage.setItem(PARTICIPANT_SESSION_KEY, seed.participants[0].id)
    window.history.replaceState(null, '', '/events/room-vibe26/live')

    render(
      <RouterProvider>
        <PlatformProvider>
          <ParticipantLivePage />
        </PlatformProvider>
      </RouterProvider>,
    )

    expect(screen.getByRole('heading', { name: '세션이 종료되었습니다.' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '나의 개인 답변' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '라이브 채팅' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /공감/ })).not.toBeInTheDocument()
  })

  it('lets a participant send a live reaction and chat message on the current slide', async () => {
    const seed = createSeedState()
    window.localStorage.setItem(PLATFORM_STORAGE_KEY, JSON.stringify(seed))
    window.sessionStorage.setItem(PARTICIPANT_SESSION_KEY, seed.participants[0].id)
    window.history.replaceState(null, '', '/events/room-vibe26/live')

    render(
      <RouterProvider>
        <PlatformProvider>
          <ParticipantLivePage />
        </PlatformProvider>
      </RouterProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: '공감 0' }))
    fireEvent.change(screen.getByRole('textbox', { name: '라이브 채팅' }), {
      target: { value: '이 질문을 조금 더 설명해주세요.' },
    })
    fireEvent.click(screen.getByRole('button', { name: '라이브 채팅 보내기' }))

    await act(async () => { await Promise.resolve() })
    expect(screen.getByRole('button', { name: '공감 1' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('이 질문을 조금 더 설명해주세요.')).toBeInTheDocument()
    const stored = JSON.parse(window.localStorage.getItem(PLATFORM_STORAGE_KEY)!)
    expect(stored.liveReactions).toEqual([
      expect.objectContaining({ participantId: seed.participants[0].id, kind: 'like' }),
    ])
    expect(stored.liveChatMessages).toEqual([
      expect.objectContaining({ participantId: seed.participants[0].id, body: '이 질문을 조금 더 설명해주세요.' }),
    ])
  })

  it('shows the current slide reaction summary and live chat to the organizer', async () => {
    const seed = createSeedState()
    const slideId = seed.slides[seed.live.activeSlideIndex].id
    seed.liveReactions = [{
      id: 'reaction-01',
      participantId: seed.participants[0].id,
      slideId,
      kind: 'question',
      updatedAt: '2026-08-05T01:01:00.000Z',
    }]
    seed.liveChatMessages = [{
      id: 'chat-01',
      participantId: seed.participants[0].id,
      slideId,
      body: '지금 단계의 예시를 보고 싶어요.',
      createdAt: '2026-08-05T01:02:00.000Z',
    }]
    window.localStorage.setItem(PLATFORM_STORAGE_KEY, JSON.stringify(seed))

    render(
      <RouterProvider>
        <PlatformProvider>
          <OrganizerControlPage />
        </PlatformProvider>
      </RouterProvider>,
    )

    expect(screen.getByRole('heading', { name: '청중 반응과 채팅' })).toBeInTheDocument()
    expect(screen.getByLabelText('질문 1개')).toHaveTextContent('1')
    expect(screen.getByText('지금 단계의 예시를 보고 싶어요.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: `${seed.participants[0].nickname} 채팅 삭제` }))
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByText('지금 단계의 예시를 보고 싶어요.')).not.toBeInTheDocument()
  })

  it('builds text and number fields in the organizer slide sandbox', async () => {
    render(
      <RouterProvider>
        <PlatformProvider>
          <OrganizerControlPage />
        </PlatformProvider>
      </RouterProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: '샌드박스' }))
    expect(screen.getByRole('dialog', { name: '슬라이드 샌드박스' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '텍스트 입력' }))
    const labelInput = screen.getByRole('textbox', { name: '입력 이름' })
    labelInput.focus()
    fireEvent.change(labelInput, { target: { value: '팀' } })
    expect(labelInput).toHaveFocus()
    fireEvent.change(labelInput, { target: { value: '팀 이름' } })
    expect(labelInput).toHaveFocus()
    const placeholderInput = screen.getByRole('textbox', { name: '안내 문구' })
    placeholderInput.focus()
    fireEvent.change(placeholderInput, { target: { value: '팀' } })
    expect(placeholderInput).toHaveFocus()
    fireEvent.change(placeholderInput, { target: { value: '팀 이름을 입력하세요' } })
    expect(placeholderInput).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: '숫자 입력' }))
    fireEvent.change(screen.getByRole('textbox', { name: '입력 이름' }), {
      target: { value: '예상 사용자 수' },
    })
    fireEvent.click(screen.getByRole('button', { name: '편집 완료' }))
    await act(async () => { await Promise.resolve() })

    const persisted = JSON.parse(window.localStorage.getItem(PLATFORM_STORAGE_KEY)!)
    expect(persisted.slides[0].inputFields).toEqual([
      expect.objectContaining({ label: '팀 이름', type: 'text' }),
      expect.objectContaining({ label: '예상 사용자 수', type: 'number' }),
    ])
    expect(screen.getByText('팀 이름 *')).toBeInTheDocument()
    expect(screen.getByText('예상 사용자 수 *')).toBeInTheDocument()
  })

  it('edits a live input structure while preserving the submitted response snapshot', async () => {
    const seed = createSeedState()
    const slide = seed.slides[seed.live.activeSlideIndex]
    slide.inputFields = [
      { id: 'field-name', type: 'text', label: '기존 질문', placeholder: '기존 안내', required: true, x: 6, y: 44, width: 54, height: 14 },
    ]
    seed.answers = [{
      id: 'answer-preserved',
      participantId: seed.participants[0].id,
      slideId: slide.id,
      content: '기존 질문: 먼저 제출한 답변',
      status: 'submitted',
      createdAt: '2026-08-07T01:00:00.000Z',
      updatedAt: '2026-08-07T01:00:00.000Z',
      submittedAt: '2026-08-07T01:00:00.000Z',
    }]
    window.localStorage.setItem(PLATFORM_STORAGE_KEY, JSON.stringify(seed))

    render(
      <RouterProvider>
        <PlatformProvider>
          <OrganizerControlPage />
        </PlatformProvider>
      </RouterProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: '샌드박스' }))
    expect(screen.getByText(/기존 응답 1개는 제출 당시 내용으로 별도 보존됩니다/)).toBeInTheDocument()
    const labelInput = screen.getByRole('textbox', { name: '입력 이름' })
    expect(labelInput).toBeEnabled()
    fireEvent.change(labelInput, { target: { value: '새 질문' } })
    fireEvent.click(screen.getByRole('button', { name: '편집 완료' }))
    await act(async () => { await Promise.resolve() })

    const persisted = JSON.parse(window.localStorage.getItem(PLATFORM_STORAGE_KEY)!)
    expect(persisted.slides[seed.live.activeSlideIndex].inputFields[0].label).toBe('새 질문')
    expect(persisted.answers[0].content).toBe('기존 질문: 먼저 제출한 답변')

    fireEvent.click(screen.getByRole('button', { name: '응답 1개 보기' }))
    const responseDrawer = screen.getByRole('complementary', { name: '현재 슬라이드 응답' })
    expect(responseDrawer).toHaveTextContent('기존 질문')
    expect(responseDrawer).toHaveTextContent('먼저 제출한 답변')
    expect(responseDrawer).not.toHaveTextContent('새 질문—')
  })

  it('collects sandbox field values as one compatible answer', async () => {
    const seed = createSeedState()
    const slide = seed.slides[seed.live.activeSlideIndex]
    slide.inputFields = [
      { id: 'field-summary', type: 'text', label: '핵심 문장', placeholder: '한 줄로 입력', required: true, x: 6, y: 44, width: 54, height: 14 },
      { id: 'field-score', type: 'number', label: '예상 시간', placeholder: '분 단위', required: true, x: 64, y: 44, width: 30, height: 14 },
    ]
    seed.answers = []
    seed.live.answersRevealedBySlide[slide.id] = false
    window.localStorage.setItem(PLATFORM_STORAGE_KEY, JSON.stringify(seed))
    window.sessionStorage.setItem(PARTICIPANT_SESSION_KEY, seed.participants[0].id)
    window.history.replaceState(null, '', '/events/room-vibe26/live')

    render(
      <RouterProvider>
        <PlatformProvider>
          <ParticipantLivePage />
        </PlatformProvider>
      </RouterProvider>,
    )

    fireEvent.change(screen.getByRole('textbox', { name: '핵심 문장' }), {
      target: { value: '참여자가 바로 이해하는 입력 경험' },
    })
    fireEvent.change(screen.getByRole('spinbutton', { name: '예상 시간' }), {
      target: { value: '15' },
    })
    const summaryWrapper = screen.getByRole('textbox', { name: '핵심 문장' }).closest('.participant-slide-field') as HTMLElement
    const scoreWrapper = screen.getByRole('spinbutton', { name: '예상 시간' }).closest('.participant-slide-field') as HTMLElement
    expect(summaryWrapper.style.left).toBe('')
    expect(summaryWrapper.style.top).toBe('')
    expect(summaryWrapper).toHaveClass('participant-slide-field--wide')
    expect(scoreWrapper.style.left).toBe('')
    expect(scoreWrapper.style.top).toBe('')
    fireEvent.click(screen.getByRole('button', { name: '임시 저장' }))
    await act(async () => { await Promise.resolve() })

    const persisted = JSON.parse(window.localStorage.getItem(PLATFORM_STORAGE_KEY)!)
    expect(persisted.answers[0].content).toBe('핵심 문장: 참여자가 바로 이해하는 입력 경험\n예상 시간: 15')
  })

  it('opens submitted sandbox responses in a drawer and detail modal', () => {
    const seed = createSeedState()
    const slide = seed.slides[seed.live.activeSlideIndex]
    slide.inputFields = [
      { id: 'field-name', type: 'text', label: '서비스 이름', placeholder: '', required: true, x: 6, y: 44, width: 54, height: 14 },
      { id: 'field-score', type: 'number', label: '기대 점수', placeholder: '', required: true, x: 64, y: 44, width: 30, height: 14 },
    ]
    seed.answers = [{
      id: 'answer-sandbox',
      participantId: seed.participants[0].id,
      slideId: slide.id,
      content: '서비스 이름: 캣보드\n기대 점수: 9',
      status: 'submitted',
      createdAt: '2026-08-07T01:00:00.000Z',
      updatedAt: '2026-08-07T01:00:00.000Z',
      submittedAt: '2026-08-07T01:00:00.000Z',
    }]
    seed.comments = [{
      id: 'comment-sandbox',
      participantId: seed.participants[1].id,
      answerId: 'answer-sandbox',
      body: '작품의 다음 단계가 궁금해요.',
      createdAt: '2026-08-07T01:02:00.000Z',
      updatedAt: '2026-08-07T01:02:00.000Z',
    }]
    window.localStorage.setItem(PLATFORM_STORAGE_KEY, JSON.stringify(seed))

    render(
      <RouterProvider>
        <PlatformProvider>
          <OrganizerControlPage />
        </PlatformProvider>
      </RouterProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: '응답 1개 보기' }))
    expect(screen.getByRole('complementary', { name: '현재 슬라이드 응답' })).toHaveTextContent('캣보드')
    expect(screen.getByRole('complementary', { name: '현재 슬라이드 응답' })).toHaveTextContent('1개')
    fireEvent.click(screen.getByRole('button', { name: '상세 보기' }))
    const detailDialog = screen.getByRole('dialog', { name: `${seed.participants[0].nickname}님의 응답` })
    expect(detailDialog).toHaveTextContent('기대 점수9')
    expect(detailDialog).toHaveTextContent(seed.participants[1].nickname)
    expect(detailDialog).toHaveTextContent('작품의 다음 단계가 궁금해요.')
  })

  it('reveals collected responses through one clear confirmation flow', async () => {
    const seed = createSeedState()
    const slide = seed.slides[seed.live.activeSlideIndex]
    seed.answers = [{
      id: 'answer-to-reveal',
      participantId: seed.participants[0].id,
      slideId: slide.id,
      content: '핵심 문장: 함께 보고 싶은 응답',
      status: 'submitted',
      createdAt: '2026-08-07T01:00:00.000Z',
      updatedAt: '2026-08-07T01:00:00.000Z',
      submittedAt: '2026-08-07T01:00:00.000Z',
    }]
    seed.live.answersRevealedBySlide[slide.id] = false
    seed.live.commentsEnabledBySlide[slide.id] = false
    window.localStorage.setItem(PLATFORM_STORAGE_KEY, JSON.stringify(seed))

    render(
      <RouterProvider>
        <PlatformProvider>
          <OrganizerControlPage />
        </PlatformProvider>
      </RouterProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: '응답 1개 공개하기' }))
    const dialog = screen.getByRole('dialog', { name: '참여자 응답을 공개할까요?' })
    expect(dialog).toHaveTextContent('함께 보고 싶은 응답')
    expect(screen.getByRole('switch', { name: '공개와 함께 댓글 열기' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('button', { name: '응답 1개 공개' }))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.queryByRole('dialog', { name: '참여자 응답을 공개할까요?' })).not.toBeInTheDocument()
    expect(screen.getByText('참여자에게 공개 중')).toBeInTheDocument()
    const persisted = JSON.parse(window.localStorage.getItem(PLATFORM_STORAGE_KEY)!)
    expect(persisted.live.answersRevealedBySlide[slide.id]).toBe(true)
    expect(persisted.live.commentsEnabledBySlide[slide.id]).toBe(true)
  })
})
