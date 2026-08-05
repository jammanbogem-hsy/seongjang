import { describe, expect, it } from 'vitest'
import { publicationThrottleRemainingMs } from './publication.js'

describe('publication cost throttle', () => {
  it('blocks a duplicate publication burst for fifteen seconds', () => {
    const lastStartedAt = { toMillis: () => 10_000 }

    expect(publicationThrottleRemainingMs(lastStartedAt, 20_000)).toBe(5_000)
    expect(publicationThrottleRemainingMs(lastStartedAt, 25_000)).toBe(0)
  })

  it('allows a first publication without a timestamp', () => {
    expect(publicationThrottleRemainingMs(null, 20_000)).toBe(0)
  })
})
