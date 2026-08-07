import type { SlideInputField } from './models'

export const MAX_SLIDE_INPUT_FIELDS = 6

export interface StoredAnswerRow {
  label: string
  value: string
}

export function slideInputFieldsValid(fields: SlideInputField[]): boolean {
  if (fields.length > MAX_SLIDE_INPUT_FIELDS) return false
  const labels = new Set<string>()
  return fields.every((field) => {
    const label = field.label.trim()
    const normalizedLabel = label.toLocaleLowerCase('ko-KR')
    if (!field.id || !/^[a-zA-Z0-9_-]{1,80}$/.test(field.id)) return false
    if (field.type !== 'text' && field.type !== 'number') return false
    if (!label || label.length > 80 || field.placeholder.length > 100) return false
    if (labels.has(normalizedLabel)) return false
    labels.add(normalizedLabel)
    if (![field.x, field.y, field.width, field.height].every(Number.isInteger)) return false
    if (field.x < 0 || field.y < 30 || field.width < 24 || field.height < 12) return false
    if (field.x + field.width > 100 || field.y + field.height > 100) return false
    return true
  })
}

export function formatSlideFieldAnswer(
  fields: SlideInputField[],
  values: Record<string, string>,
): string {
  return fields
    .flatMap((field) => {
      const value = (values[field.id] ?? '').trim()
      return value ? [`${field.label.trim()}: ${value}`] : []
    })
    .join('\n')
}

export function parseSlideFieldAnswer(
  fields: SlideInputField[],
  content: string,
): Record<string, string> {
  if (!fields.length || !content.trim()) return {}
  const lines = content.split(/\r?\n/u)
  return Object.fromEntries(fields.map((field) => {
    const prefix = `${field.label.trim()}:`
    const line = lines.find((candidate) => candidate.startsWith(prefix))
    return [field.id, line ? line.slice(prefix.length).trimStart() : '']
  }))
}

export function parseStoredAnswerRows(content: string): StoredAnswerRow[] {
  const lines = content.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
  if (!lines.length || lines.length > MAX_SLIDE_INPUT_FIELDS) return []
  const rows = lines.map((line): StoredAnswerRow | null => {
    const separator = line.indexOf(':')
    if (separator < 1) return null
    const label = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    if (!label || label.length > 80 || !value) return null
    return { label, value }
  })
  return rows.every((row): row is StoredAnswerRow => row !== null) ? rows : []
}

export function slideFieldAnswerComplete(
  fields: SlideInputField[],
  values: Record<string, string>,
): boolean {
  return fields.some((field) => (values[field.id] ?? '').trim())
    && fields.every((field) => !field.required || Boolean((values[field.id] ?? '').trim()))
}
