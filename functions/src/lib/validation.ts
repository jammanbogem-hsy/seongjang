import { createHash } from 'node:crypto'
import { HttpsError } from 'firebase-functions/v2/https'

export type UnknownRecord = Record<string, unknown>

export function asRecord(value: unknown, label = '요청'): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpsError('invalid-argument', `${label} 형식이 올바르지 않습니다.`)
  }
  return value as UnknownRecord
}

export function requiredString(
  record: UnknownRecord,
  key: string,
  options: { min?: number; max?: number; label?: string } = {},
): string {
  const value = record[key]
  const label = options.label ?? key
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', `${label}을(를) 입력해주세요.`)
  }
  const normalized = value.trim()
  if (normalized.length < (options.min ?? 1) || normalized.length > (options.max ?? 10_000)) {
    throw new HttpsError('invalid-argument', `${label}의 길이를 확인해주세요.`)
  }
  return normalized
}

export function optionalString(
  record: UnknownRecord,
  key: string,
  max: number,
): string {
  const value = record[key]
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string' || value.length > max) {
    throw new HttpsError('invalid-argument', `${key} 형식이 올바르지 않습니다.`)
  }
  return value.trim()
}

export function requiredBoolean(record: UnknownRecord, key: string): boolean {
  const value = record[key]
  if (typeof value !== 'boolean') {
    throw new HttpsError('invalid-argument', `${key} 값이 올바르지 않습니다.`)
  }
  return value
}

export function requiredInteger(
  record: UnknownRecord,
  key: string,
  min: number,
  max: number,
): number {
  const value = record[key]
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new HttpsError('invalid-argument', `${key} 값이 올바르지 않습니다.`)
  }
  return value as number
}

export function stringArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new HttpsError('invalid-argument', '목록 형식이 올바르지 않습니다.')
  }
  return value.map((item) => {
    if (typeof item !== 'string') {
      throw new HttpsError('invalid-argument', '목록 항목 형식이 올바르지 않습니다.')
    }
    const normalized = item.trim()
    if (!normalized || normalized.length > maxLength) {
      throw new HttpsError('invalid-argument', '목록 항목 길이를 확인해주세요.')
    }
    return normalized
  })
}

export function normalizeNickname(value: string): { nickname: string; normalizedNickname: string } {
  const nickname = value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
  const length = Array.from(nickname).length
  if (length < 2 || length > 16) {
    throw new HttpsError('invalid-argument', '닉네임은 2자 이상 16자 이하로 입력해주세요.')
  }
  return {
    nickname,
    normalizedNickname: nickname.toLocaleLowerCase('ko-KR'),
  }
}

export function nicknameIndexId(eventId: string, normalizedNickname: string): string {
  return createHash('sha256')
    .update(`${eventId}\u0000${normalizedNickname}`, 'utf8')
    .digest('hex')
}

export function normalizeRoomCode(value: string): string {
  const code = value.normalize('NFKC').trim().toUpperCase()
  if (!/^[A-Z0-9]{4,12}$/.test(code)) {
    throw new HttpsError('invalid-argument', '방 코드를 다시 확인해주세요.')
  }
  return code
}

export function normalizePin(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}$/.test(value)) {
    throw new HttpsError('invalid-argument', '개인 입장코드는 숫자 4자리여야 합니다.')
  }
  return value
}

export function normalizeEmail(value: string): string {
  const email = value.normalize('NFKC').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new HttpsError('invalid-argument', '올바른 이메일 주소를 입력해주세요.')
  }
  return email
}

export function optionalWebUrl(value: string): string {
  if (!value) return ''
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new HttpsError('invalid-argument', '링크 주소를 다시 확인해주세요.')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new HttpsError('invalid-argument', '링크는 http 또는 https 주소여야 합니다.')
  }
  return url.toString()
}

export function safeDocumentId(value: string, label = 'ID'): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new HttpsError('invalid-argument', `${label} 형식이 올바르지 않습니다.`)
  }
  return value
}

export function assertNever(value: never): never {
  throw new HttpsError('invalid-argument', `지원하지 않는 명령입니다: ${String(value)}`)
}
