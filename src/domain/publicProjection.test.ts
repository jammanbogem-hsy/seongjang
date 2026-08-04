import { describe, expect, it } from 'vitest'
import { createTextExport, snapshotToCsv, snapshotToJson, snapshotToMarkdown } from './exports'
import { containsPrivatePublicFields, createPublishedSnapshot, sanitizeForPublic } from './publicProjection'
import { createSeedState } from './seed'

describe('public projection', () => {
  it('reconstructs public data without PIN, email, IDs or unrevealed answers', () => {
    const seed = createSeedState()
    const projection = sanitizeForPublic(seed)
    const serialized = JSON.stringify(projection)

    expect(containsPrivatePublicFields(projection)).toBe(false)
    expect(serialized).not.toContain(seed.participants[0].pin)
    expect(serialized).not.toContain(seed.adminInvites[0].email)
    expect(serialized).not.toContain('participant-01')
    expect(projection.stages.find((stage) => stage.key === 'stage-4')?.answers).toHaveLength(0)
  })

  it('creates an immutable snapshot shared by JSON, CSV, Markdown and README', () => {
    const snapshot = createPublishedSnapshot(createSeedState(), '2026-08-05T01:00:00.000Z')
    const json = snapshotToJson(snapshot)
    const csv = snapshotToCsv(snapshot)
    const markdown = snapshotToMarkdown(snapshot)
    const readme = createTextExport(snapshot, 'readme')

    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.data)).toBe(true)
    expect(JSON.parse(json).revision).toBe(snapshot.revision)
    expect(csv).toContain(String(snapshot.revision))
    expect(markdown).toContain(`공개 리비전: ${snapshot.revision}`)
    expect(readme.filename).toBe('README.md')
    expect(readme.content).toContain(`공개 데이터 리비전 ${snapshot.revision}`)
  })

  it('neutralizes spreadsheet formulas in participant-controlled CSV cells', () => {
    const seed = createSeedState()
    seed.answers[0] = { ...seed.answers[0], content: '=HYPERLINK("https://example.com")' }
    seed.comments[0] = { ...seed.comments[0], body: '  +1+1' }
    const snapshot = createPublishedSnapshot(seed, '2026-08-05T01:00:00.000Z')
    const csv = snapshotToCsv(snapshot)

    expect(csv).toContain("'=HYPERLINK")
    expect(csv).toContain("'  +1+1")
    expect(csv).not.toContain(',=HYPERLINK')
  })
})
