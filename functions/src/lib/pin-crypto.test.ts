import { describe, expect, it } from 'vitest'
import { createPinVerifier, decryptPin, encryptPin, verifyPin } from './pin-crypto.js'

const secret = Buffer.alloc(32, 7).toString('base64')

describe('participant PIN protection', () => {
  it('verifies the PIN without persisting the PIN itself', () => {
    const verifier = createPinVerifier(secret, 'room-vibe26', 'participant-1', '0042')
    expect(verifier).not.toContain('0042')
    expect(verifyPin(secret, 'room-vibe26', 'participant-1', '0042', verifier)).toBe(true)
    expect(verifyPin(secret, 'room-vibe26', 'participant-1', '0043', verifier)).toBe(false)
    expect(verifyPin(secret, 'room-other', 'participant-1', '0042', verifier)).toBe(false)
  })

  it('encrypts a revealable PIN with event and participant binding', () => {
    const encrypted = encryptPin(secret, 'room-vibe26', 'participant-1', '0042')
    expect(JSON.stringify(encrypted)).not.toContain('0042')
    expect(decryptPin(secret, 'room-vibe26', 'participant-1', encrypted)).toBe('0042')
    expect(() => decryptPin(secret, 'room-vibe26', 'participant-2', encrypted)).toThrow()
  })
})
