import { afterEach, describe, expect, it } from 'vitest'
import { clearSensitiveBrowserState } from './securityStorage'

describe('clearSensitiveBrowserState', () => {
  afterEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it('clears private draft and participant session keys without removing unrelated preferences', () => {
    window.sessionStorage.setItem('vibecoding.answer-drafts.room-1', 'private-answer')
    window.localStorage.setItem('vibecoding.review-reply.room-1', 'legacy-private-review')
    window.sessionStorage.setItem('vibecoding.prototype.participant.v1', 'private-session')
    window.localStorage.setItem('vibecoding.theme', 'dark')

    clearSensitiveBrowserState()

    expect(window.sessionStorage.getItem('vibecoding.answer-drafts.room-1')).toBeNull()
    expect(window.localStorage.getItem('vibecoding.review-reply.room-1')).toBeNull()
    expect(window.sessionStorage.getItem('vibecoding.prototype.participant.v1')).toBeNull()
    expect(window.localStorage.getItem('vibecoding.theme')).toBe('dark')
  })
})
