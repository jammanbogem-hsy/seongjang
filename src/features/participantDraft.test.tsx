import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

function RemoteAnswerHarness() {
  const { currentParticipant, currentSlide, dispatch } = usePlatform()
  return (
    <button
      onClick={() => {
        if (!currentParticipant) return
        dispatch({
          type: 'SAVE_ANSWER',
          input: {
            content: '다른 기기에서 먼저 저장한 최신 답변',
            participantId: currentParticipant.id,
            slideId: currentSlide.id,
            submit: false,
          },
        })
      }}
      type="button"
    >다른 기기 저장</button>
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

  it('preserves text across active slide changes and uses the canonical saved value', async () => {
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

    await waitFor(() => {
      expect(screen.getByLabelText('나의 개인 답변')).toHaveValue('아직 제출하지 않은 중요한 초안')
    })
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

  it('autosaves a changed answer as a draft after the debounce window', async () => {
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
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500)
    })

    const persisted = JSON.parse(window.localStorage.getItem(PLATFORM_STORAGE_KEY)!)
    const saved = persisted.answers.find(
      (answer: { participantId: string; slideId: string }) =>
        answer.participantId === persisted.participants[0].id && answer.slideId === persisted.slides[3].id,
    )
    expect(saved).toMatchObject({ content: '자동 저장되는 새로운 단계 답변', status: 'draft' })
    expect(screen.getByText(/모든 변경사항 저장됨/)).toBeInTheDocument()
  })

  it('does not overwrite a newer server answer with an untracked restored draft', async () => {
    vi.useFakeTimers()
    const persistedBefore = JSON.parse(window.localStorage.getItem(PLATFORM_STORAGE_KEY)!)
    const participantId = persistedBefore.participants[0].id
    const slideId = persistedBefore.slides[3].id
    const remoteBefore = persistedBefore.answers.find(
      (answer: { participantId: string; slideId: string }) => (
        answer.participantId === participantId && answer.slideId === slideId
      ),
    )
    window.localStorage.setItem(
      `vibecoding.answer-drafts.${participantId}`,
      JSON.stringify({ [slideId]: '다른 기기보다 오래된 복구 초안' }),
    )
    window.localStorage.setItem(
      `vibecoding.answer-drafts.${participantId}.base-updated-at`,
      JSON.stringify({ [slideId]: '2025-01-01T00:00:00.000Z' }),
    )

    render(
      <RouterProvider>
        <PlatformProvider>
          <ParticipantLivePage />
        </PlatformProvider>
      </RouterProvider>,
    )

    expect(screen.getByText(/Firebase에 더 최신 답변/)).toBeInTheDocument()
    await act(async () => {
      vi.advanceTimersByTime(1_000)
      await Promise.resolve()
    })

    const stillPersisted = JSON.parse(window.localStorage.getItem(PLATFORM_STORAGE_KEY)!)
    const stillRemote = stillPersisted.answers.find(
      (answer: { participantId: string; slideId: string }) => (
        answer.participantId === participantId && answer.slideId === slideId
      ),
    )
    expect(stillRemote?.content).toBe(remoteBefore?.content)

    fireEvent.click(screen.getByRole('button', { name: '내 초안으로 계속 편집' }))
    fireEvent.change(screen.getByLabelText('나의 개인 답변'), {
      target: { value: '사용자가 다시 편집한 안전한 최신 초안' },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500)
    })

    const persistedAfterEdit = JSON.parse(window.localStorage.getItem(PLATFORM_STORAGE_KEY)!)
    const savedAfterEdit = persistedAfterEdit.answers.find(
      (answer: { participantId: string; slideId: string }) => (
        answer.participantId === participantId && answer.slideId === slideId
      ),
    )
    expect(savedAfterEdit?.content).toBe('사용자가 다시 편집한 안전한 최신 초안')
  })

  it('keeps the edit-start revision when another device saves during the debounce', async () => {
    vi.useFakeTimers()
    render(
      <RouterProvider>
        <PlatformProvider>
          <ParticipantLivePage />
          <RemoteAnswerHarness />
        </PlatformProvider>
      </RouterProvider>,
    )

    fireEvent.change(screen.getByLabelText('나의 개인 답변'), {
      target: { value: '첫 기기에서 아직 저장하지 않은 답변' },
    })
    fireEvent.click(screen.getByRole('button', { name: '다른 기기 저장' }))
    expect(screen.getByText(/Firebase에 더 최신 답변/)).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500)
    })
    const persistedAfterConflict = JSON.parse(window.localStorage.getItem(PLATFORM_STORAGE_KEY)!)
    const remoteAfterConflict = persistedAfterConflict.answers.find(
      (answer: { participantId: string; slideId: string }) => (
        answer.participantId === persistedAfterConflict.participants[0].id
        && answer.slideId === persistedAfterConflict.slides[3].id
      ),
    )
    expect(remoteAfterConflict?.content).toBe('다른 기기에서 먼저 저장한 최신 답변')

    fireEvent.click(screen.getByRole('button', { name: '내 초안으로 계속 편집' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500)
    })
    const persistedAfterAccept = JSON.parse(window.localStorage.getItem(PLATFORM_STORAGE_KEY)!)
    const savedAfterAccept = persistedAfterAccept.answers.find(
      (answer: { participantId: string; slideId: string }) => (
        answer.participantId === persistedAfterAccept.participants[0].id
        && answer.slideId === persistedAfterAccept.slides[3].id
      ),
    )
    expect(savedAfterAccept?.content).toBe('첫 기기에서 아직 저장하지 않은 답변')
  })
})
