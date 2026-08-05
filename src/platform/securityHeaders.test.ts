import firebaseConfig from '../../firebase.json'
import { describe, expect, it } from 'vitest'

describe('Firebase Hosting content security policy', () => {
  it('allows the exact Google API loader required by Firebase popup authentication', () => {
    const policies = firebaseConfig.hosting.headers
      .flatMap((rule) => rule.headers)
      .filter((header) => header.key === 'Content-Security-Policy')
      .map((header) => header.value)

    expect(policies.length).toBeGreaterThan(0)
    policies.forEach((policy) => {
      expect(policy).toContain('script-src ')
      expect(policy).toContain('script-src-elem ')
      expect(policy).toContain('https://apis.google.com')
      expect(policy).toContain("object-src 'none'")
      expect(policy).not.toContain('script-src *')
    })
  })
})
