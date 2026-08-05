import { describe, expect, it } from 'vitest'
import { executePlatformCommand, getTimerView } from './commands'
import type { Participant } from './models'
import { createSeedState } from './seed'

const env = { now: () => Date.parse('2026-08-05T01:00:00.000Z'), createId: (prefix: string) => `${prefix}-test` }

describe('participant entry', () => {
  it('creates a new participant and re-enters only with the same PIN', () => {
    const seed = createSeedState()
    const created = executePlatformCommand(
      seed,
      { type: 'JOIN_PARTICIPANT', input: { roomCode: 'vibe26', nickname: '  새 별  ', pin: '0042' } },
      env,
    )
    expect(created.result.ok).toBe(true)
    expect(created.state.participants).toHaveLength(seed.participants.length + 1)
    expect(created.state.participants.at(-1)?.nickname).toBe('새 별')

    const wrongPin = executePlatformCommand(
      created.state,
      { type: 'JOIN_PARTICIPANT', input: { roomCode: 'VIBE26', nickname: '새  별', pin: '9999' } },
      env,
    )
    expect(wrongPin.result).toMatchObject({ ok: false, error: { code: 'PIN_MISMATCH' } })

    const reentered = executePlatformCommand(
      created.state,
      { type: 'JOIN_PARTICIPANT', input: { roomCode: 'VIBE26', nickname: '새 별', pin: '0042' } },
      env,
    )
    expect(reentered.result.ok).toBe(true)
    expect(reentered.state.participants).toHaveLength(created.state.participants.length)
  })

  it('rejects a new participant when the room reaches 100 people', () => {
    const seed = createSeedState()
    const fillers: Participant[] = Array.from({ length: 100 - seed.participants.length }, (_, index) => ({
      ...seed.participants[0],
      id: `filler-${index}`,
      nickname: `채움${index}`,
      normalizedNickname: `채움${index}`,
      pin: String(index).padStart(4, '0'),
    }))
    const full = { ...seed, participants: [...seed.participants, ...fillers] }
    const outcome = executePlatformCommand(
      full,
      { type: 'JOIN_PARTICIPANT', input: { roomCode: 'VIBE26', nickname: '마지막', pin: '1234' } },
      env,
    )
    expect(outcome.result).toMatchObject({ ok: false, error: { code: 'ROOM_FULL' } })
  })
})

describe('live controls', () => {
  it('derives timer ticks from endsAt and preserves the pause value', () => {
    const seed = createSeedState()
    const started = executePlatformCommand(seed, { type: 'START_TIMER' }, env)
    expect(started.state.live.timer.status).toBe('running')
    expect(getTimerView(started.state.live.timer, env.now() + 12_000).remainingSec).toBe(630)

    const paused = executePlatformCommand(started.state, { type: 'PAUSE_TIMER' }, { ...env, now: () => env.now() + 12_000 })
    expect(paused.state.live.timer).toMatchObject({ status: 'paused', remainingSec: 630, endsAt: null })
  })

  it('requires answer reveal before comments can open', () => {
    const seed = createSeedState()
    const slideId = 'stage-reflect'
    const blocked = executePlatformCommand(seed, { type: 'SET_COMMENTS_ENABLED', slideId, enabled: true }, env)
    expect(blocked.result).toMatchObject({ ok: false, error: { code: 'NOT_ALLOWED' } })
    const revealed = executePlatformCommand(seed, { type: 'SET_ANSWERS_REVEALED', slideId, revealed: true }, env)
    const opened = executePlatformCommand(revealed.state, { type: 'SET_COMMENTS_ENABLED', slideId, enabled: true }, env)
    expect(opened.result.ok).toBe(true)
    expect(opened.state.live.commentsEnabledBySlide[slideId]).toBe(true)
  })

  it('persists a custom timer duration on the active slide', () => {
    const seed = createSeedState()
    const updated = executePlatformCommand(seed, { type: 'SET_TIMER_DURATION', durationSec: 900 }, env)

    expect(updated.result.ok).toBe(true)
    expect(updated.state.live.timer).toMatchObject({
      durationSec: 900,
      remainingSec: 900,
      status: 'idle',
    })
    expect(updated.state.slides[updated.state.live.activeSlideIndex].durationSec).toBe(900)
    expect(updated.state.slides[updated.state.live.activeSlideIndex].eyebrow).toContain('15분')

    const running = executePlatformCommand(updated.state, { type: 'START_TIMER' }, env)
    const blocked = executePlatformCommand(running.state, { type: 'SET_TIMER_DURATION', durationSec: 300 }, env)
    expect(blocked.result).toMatchObject({ ok: false, error: { code: 'NOT_ALLOWED' } })
  })

  it('updates slide content used by both organizer and participant views', () => {
    const seed = createSeedState()
    const slide = seed.slides[seed.live.activeSlideIndex]
    const updated = executePlatformCommand(seed, {
      type: 'UPDATE_SLIDE',
      input: {
        slideId: slide.id,
        eyebrow: 'LIVE · TOGETHER',
        title: '함께 고친 질문',
        prompt: '참여자 화면에도 이 문장이 보여야 합니다.',
        helper: '답변은 자동 저장됩니다.',
      },
    }, env)

    expect(updated.result.ok).toBe(true)
    expect(updated.state.slides.find((candidate) => candidate.id === slide.id)).toMatchObject({
      eyebrow: 'LIVE · TOGETHER',
      title: '함께 고친 질문',
      prompt: '참여자 화면에도 이 문장이 보여야 합니다.',
      helper: '답변은 자동 저장됩니다.',
    })
  })

  it('creates, reorders and deletes an unanswered slide while preserving the live page', () => {
    const seed = createSeedState()
    const activeSlideId = seed.slides[seed.live.activeSlideIndex].id
    const created = executePlatformCommand(seed, {
      type: 'CREATE_SLIDE',
      input: {
        eyebrow: 'TEST · 7분',
        title: '새로운 검증 질문',
        prompt: '참여자에게 실시간으로 보일 질문입니다.',
        helper: '개인 답변을 입력해주세요.',
        durationSec: 420,
        illustration: '/assets/illustrations/cat-ideation.webp',
      },
    }, env)

    expect(created.result.ok).toBe(true)
    expect(created.state.slides.at(-1)).toMatchObject({ id: 'slide-test', order: seed.slides.length + 1 })
    expect(created.state.live.answersRevealedBySlide['slide-test']).toBe(false)

    const moved = executePlatformCommand(
      created.state,
      { type: 'MOVE_SLIDE', slideId: 'slide-test', direction: 'up' },
      env,
    )
    expect(moved.result.ok).toBe(true)
    expect(moved.state.slides.at(-2)?.id).toBe('slide-test')
    expect(moved.state.slides[moved.state.live.activeSlideIndex].id).toBe(activeSlideId)

    const deleted = executePlatformCommand(moved.state, { type: 'DELETE_SLIDE', slideId: 'slide-test' }, env)
    expect(deleted.result.ok).toBe(true)
    expect(deleted.state.slides).toHaveLength(seed.slides.length)
    expect(deleted.state.slides[moved.state.live.activeSlideIndex].id).toBe(activeSlideId)
  })

  it('protects participant records and an actively running slide from deletion', () => {
    const seed = createSeedState()
    const answeredSlideId = seed.answers[0].slideId
    const answered = executePlatformCommand(seed, { type: 'DELETE_SLIDE', slideId: answeredSlideId }, env)
    expect(answered.result).toMatchObject({ ok: false, error: { code: 'NOT_ALLOWED' } })

    const started = executePlatformCommand(seed, { type: 'START_TIMER' }, env)
    const activeSlideId = started.state.slides[started.state.live.activeSlideIndex].id
    const running = executePlatformCommand(started.state, { type: 'DELETE_SLIDE', slideId: activeSlideId }, env)
    expect(running.result).toMatchObject({ ok: false, error: { code: 'NOT_ALLOWED' } })
  })
})

describe('autosave semantics', () => {
  it('updates submitted work without downgrading its submission status', () => {
    const seed = createSeedState()
    const answer = seed.answers.find((candidate) => candidate.slideId === seed.slides[2].id)!
    const editable = executePlatformCommand(
      seed,
      { type: 'SET_ANSWERS_REVEALED', slideId: answer.slideId, revealed: false },
      env,
    ).state
    const answerAutosave = executePlatformCommand(
      editable,
      {
        type: 'SAVE_ANSWER',
        input: {
          participantId: answer.participantId,
          slideId: answer.slideId,
          content: '자동 저장으로 수정된 제출 답변',
          submit: false,
        },
      },
      env,
    )
    expect(answerAutosave.state.answers.find((candidate) => candidate.id === answer.id)).toMatchObject({
      content: '자동 저장으로 수정된 제출 답변',
      status: 'submitted',
    })

    const submission = seed.submissions[0]
    const projectAutosave = executePlatformCommand(
      seed,
      {
        type: 'SUBMIT_PROJECT',
        input: {
          participantId: submission.participantId,
          title: `${submission.title} 수정`,
          pitch: submission.pitch,
          description: submission.description,
          demoUrl: submission.demoUrl,
          githubUrl: submission.githubUrl,
          tags: submission.tags,
          retrospective: submission.retrospective,
          submit: false,
        },
      },
      env,
    )
    expect(projectAutosave.state.submissions.find((candidate) => candidate.id === submission.id)).toMatchObject({
      title: `${submission.title} 수정`,
      status: 'submitted',
    })
  })
})
