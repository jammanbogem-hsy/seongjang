import { describe, expect, it } from 'vitest'
import { nicknameIndexId, normalizeNickname, normalizePin, normalizeRoomCode } from './validation.js'

describe('join input normalization', () => {
  it('normalizes nickname variants to the same index', () => {
    const first = normalizeNickname('  검증  별빛 ')
    const second = normalizeNickname('검증 별빛')
    expect(first.nickname).toBe('검증 별빛')
    expect(nicknameIndexId('room-vibe26', first.normalizedNickname)).toBe(
      nicknameIndexId('room-vibe26', second.normalizedNickname),
    )
  })

  it('preserves PIN leading zeroes and normalizes room codes', () => {
    expect(normalizePin('0042')).toBe('0042')
    expect(normalizeRoomCode(' vibe26 ')).toBe('VIBE26')
  })
})
