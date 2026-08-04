import type { TextExport } from '../domain/exports'

export function downloadTextExport(file: TextExport): void {
  if (typeof document === 'undefined') return
  const blob = new Blob([file.content], { type: file.mimeType })
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = file.filename
  anchor.click()
  URL.revokeObjectURL(href)
}
