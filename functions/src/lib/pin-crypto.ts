import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

export interface EncryptedPin {
  algorithm: 'aes-256-gcm'
  authTag: string
  ciphertext: string
  iv: string
  keyVersion: 1
}

function masterKey(secret: string): Buffer {
  if (secret.length < 32) throw new Error('PARTICIPANT_SECRET_KEY must contain at least 32 characters')
  try {
    const decoded = Buffer.from(secret, 'base64')
    if (decoded.length >= 32) return decoded.subarray(0, 32)
  } catch {
    // Fall through to the deterministic digest for non-base64 Secret Manager values.
  }
  return createHash('sha256').update(secret, 'utf8').digest()
}

function deriveKey(secret: string, purpose: 'pin-encryption' | 'pin-verifier'): Buffer {
  const derived = hkdfSync(
    'sha256',
    masterKey(secret),
    Buffer.from('vibecoding-participant-secret-v1', 'utf8'),
    Buffer.from(purpose, 'utf8'),
    32,
  )
  return Buffer.from(derived)
}

function aad(eventId: string, participantUid: string): Buffer {
  return Buffer.from(`${eventId}\u0000${participantUid}`, 'utf8')
}

export function createPinVerifier(
  secret: string,
  eventId: string,
  participantUid: string,
  pin: string,
): string {
  return createHmac('sha256', deriveKey(secret, 'pin-verifier'))
    .update(aad(eventId, participantUid))
    .update('\u0000', 'utf8')
    .update(pin, 'utf8')
    .digest('base64url')
}

export function verifyPin(
  secret: string,
  eventId: string,
  participantUid: string,
  pin: string,
  expectedVerifier: string,
): boolean {
  const actual = Buffer.from(createPinVerifier(secret, eventId, participantUid, pin), 'utf8')
  const expected = Buffer.from(expectedVerifier, 'utf8')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function encryptPin(
  secret: string,
  eventId: string,
  participantUid: string,
  pin: string,
): EncryptedPin {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret, 'pin-encryption'), iv)
  cipher.setAAD(aad(eventId, participantUid))
  const ciphertext = Buffer.concat([cipher.update(pin, 'utf8'), cipher.final()])
  return {
    algorithm: 'aes-256-gcm',
    authTag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
    iv: iv.toString('base64url'),
    keyVersion: 1,
  }
}

export function decryptPin(
  secret: string,
  eventId: string,
  participantUid: string,
  encrypted: EncryptedPin,
): string {
  if (encrypted.algorithm !== 'aes-256-gcm' || encrypted.keyVersion !== 1) {
    throw new Error('Unsupported PIN encryption envelope')
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    deriveKey(secret, 'pin-encryption'),
    Buffer.from(encrypted.iv, 'base64url'),
  )
  decipher.setAAD(aad(eventId, participantUid))
  decipher.setAuthTag(Buffer.from(encrypted.authTag, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}
