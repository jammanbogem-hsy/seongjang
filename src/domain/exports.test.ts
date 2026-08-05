import { describe, expect, it } from 'vitest'
import { createEmbedSnippet } from './exports'
import { createSeedState } from './seed'

describe('public embed export', () => {
  it('follows the session public projection without claiming an unsupported revision pin', () => {
    const snapshot = createSeedState().publishedSnapshot
    expect(snapshot).not.toBeNull()

    const embed = createEmbedSnippet(snapshot!, 'https://events.example')

    expect(embed).toContain('src="https://events.example/embed/VIBE26"')
    expect(embed).not.toContain('?revision=')
  })
})
