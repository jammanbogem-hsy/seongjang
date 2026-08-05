import { describe, expect, it } from 'vitest'
import { invalidCredentialHitsActiveLock } from './credential-lock.js'

describe('invalidCredentialHitsActiveLock', () => {
  it('allows a valid PIN or entry code to bypass an attacker-created lock', () => {
    expect(invalidCredentialHitsActiveLock(true, 1_000, 10_000, 20_000)).toBe(false)
  })

  it('blocks only invalid credentials while a lock is active', () => {
    expect(invalidCredentialHitsActiveLock(false, 1_000, null, 10_000)).toBe(true)
    expect(invalidCredentialHitsActiveLock(false, 11_000, null, 10_000)).toBe(false)
  })
})
