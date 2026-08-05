const SENSITIVE_STORAGE_PREFIXES = [
  'vibecoding.answer-drafts.',
  'vibecoding.comment-drafts.',
  'vibecoding.comment-edit-drafts.',
  'vibecoding.project-draft.',
  'vibecoding.review-composer.',
  'vibecoding.review-reply.',
  'vibecoding.synthesis-draft.',
]

export function clearSensitiveBrowserState(): void {
  if (typeof window === 'undefined') return
  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index)
      if (key && SENSITIVE_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        window.localStorage.removeItem(key)
      }
    }
    for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = window.sessionStorage.key(index)
      if (key && SENSITIVE_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        window.sessionStorage.removeItem(key)
      }
    }
    window.sessionStorage.removeItem('vibecoding.prototype.participant.v1')
  } catch {
    // Storage can be unavailable in privacy modes; Firebase sign-out still runs.
  }
}
