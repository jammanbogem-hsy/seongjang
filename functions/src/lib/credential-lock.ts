export function invalidCredentialHitsActiveLock(
  credentialValid: boolean,
  nowMs: number,
  ...lockedUntilValues: Array<number | null | undefined>
): boolean {
  return !credentialValid && lockedUntilValues.some(
    (lockedUntil) => typeof lockedUntil === 'number' && lockedUntil > nowMs,
  )
}
