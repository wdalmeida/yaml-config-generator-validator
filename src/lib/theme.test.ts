import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyTheme, readTheme, THEME_CHOICES, THEME_KEY } from './theme'
import { writePersistedState } from './persisted-state'

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme')
  })

  it('defaults to auto', () => {
    expect(readTheme()).toBe('auto')
  })

  it('round-trips each choice', () => {
    for (const choice of THEME_CHOICES) {
      writePersistedState(THEME_KEY, choice)
      expect(readTheme()).toBe(choice)
    }
  })

  // This value lives in the reader's browser and can outlive whatever wrote it - the same
  // reasoning as getNavEntry's fallback for a stale pill id. A junk value must not throw into a
  // blank page, and must not be written onto <html> either.
  it('falls back to auto for anything unrecognised', () => {
    for (const junk of ['solarized', '', null, 42, { theme: 'dark' }]) {
      writePersistedState(THEME_KEY, junk)
      expect(readTheme()).toBe('auto')
    }
  })

  // Auto is the ABSENCE of the attribute, not a third value. The CSS keys off that absence so
  // the media query does the work - writing data-theme="auto" would match neither rule and
  // leave a reader on a dark OS with the light palette.
  it('clears the attribute for auto rather than writing it', () => {
    applyTheme('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    applyTheme('auto')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('writes the attribute for an explicit choice', () => {
    applyTheme('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    applyTheme('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })
})
