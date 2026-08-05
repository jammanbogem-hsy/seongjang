import { describe, expect, it } from 'vitest'
import { isVerifiedGoogleIdentity } from './authz.js'

describe('isVerifiedGoogleIdentity', () => {
  it('accepts an email-verified Google identity', () => {
    expect(isVerifiedGoogleIdentity({
      email: 'admin@gmail.com',
      email_verified: true,
      firebase: { sign_in_provider: 'google.com' },
    })).toBe(true)
  })

  it.each([
    ['email-link identity', { email: 'admin@gmail.com', email_verified: true, firebase: { sign_in_provider: 'emailLink' } }],
    ['unverified Google identity', { email: 'admin@gmail.com', email_verified: false, firebase: { sign_in_provider: 'google.com' } }],
    ['identity without an email', { email_verified: true, firebase: { sign_in_provider: 'google.com' } }],
  ])('rejects %s', (_label, token) => {
    expect(isVerifiedGoogleIdentity(token)).toBe(false)
  })
})
