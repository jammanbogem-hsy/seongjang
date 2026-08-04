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
})
