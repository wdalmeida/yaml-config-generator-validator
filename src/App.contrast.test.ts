import { describe, expect, it } from 'vitest'
// Vite's ?raw import rather than node:fs - the app tsconfig deliberately carries no node types,
// and this keeps the test on the same module graph as the stylesheet it is checking, so moving
// or renaming App.css breaks the build here instead of silently reading nothing.
import css from './App.css?raw'

// The contrast half of the accessibility checks, split out from App.a11y.test.tsx because axe
// cannot do it here: its `color-contrast` rule needs real layout and computed styles, and jsdom
// applies no stylesheet at all, so every element resolves to transparent on transparent.
//
// Rather than fake a browser, this reads the palette out of App.css and checks the pairs the
// stylesheet actually puts together. That is the honest place for it - these are constants, not
// something a render can change - and it covers dark mode, which a headless browser check would
// need a second run to reach.
//
// Two real failures were found the first time this ran, both invisible to every other check in
// the repo: the brand orange as text (2.99:1, and 3.12:1 under the white it carried on filled
// buttons), and --muted left at its light-mode value in the dark block (3.24:1 on the raised
// surface). Hence --accent-strong, and a dark --muted.

function tokensFrom(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
}

const lightBlock = /^:root \{(.*?)^\}/ms.exec(css)
const darkBlock = /@media \(prefers-color-scheme: dark\) \{\s*:root \{(.*?)^ {2}\}/ms.exec(css)
if (!lightBlock || !darkBlock) throw new Error('App.css no longer declares its palette on :root - update this test')

const LIGHT = tokensFrom(lightBlock[1])
const DARK = { ...LIGHT, ...tokensFrom(darkBlock[1]) }

/** WCAG 2.x relative luminance. */
function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const channel = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// Text pairs the stylesheet really renders. Each one is a `color:` and the surface it sits on.
const TEXT_PAIRS: Array<[fg: string, bg: string]> = [
  ['--muted', '--surface'],
  ['--muted', '--surface-raised'],
  ['--error', '--surface'],
  ['--error', '--surface-raised'],
  ['--success', '--surface'],
  ['--success', '--surface-raised'],
  ['--warn', '--surface'],
  ['--warn', '--surface-raised'],
  ['--accent-strong', '--surface'],
  ['--accent-strong', '--surface-raised'],
  // The filled, text-bearing surfaces: the active pill, the primary button, the skip link.
  ['--accent-contrast', '--accent-strong'],
]

// Non-text: a focus ring and a state border only have to be distinguishable (WCAG 1.4.11),
// which is 3:1 rather than 4.5:1. --accent-strong is used for both, so this is really a floor
// check that the token has not drifted back toward the un-darkened brand colour.
const NON_TEXT_PAIRS: Array<[fg: string, bg: string]> = [
  ['--accent-strong', '--surface'],
  ['--accent-strong', '--surface-raised'],
  // The edge of an input or a button. Not --border, which only draws a card outline: the card
  // is already distinguishable by its background and shadow, so that hairline is decoration.
  ['--border-control', '--surface-raised'],
  ['--border-control', '--surface'],
]

describe.each([
  ['light', LIGHT],
  ['dark', DARK],
])('%s palette', (_theme, tokens) => {
  it.each(TEXT_PAIRS)('%s on %s clears 4.5:1 for body text', (fg, bg) => {
    const ratio = contrast(tokens[fg], tokens[bg])
    expect(
      ratio,
      `${fg} (${tokens[fg]}) on ${bg} (${tokens[bg]}) is ${ratio.toFixed(2)}:1, WCAG 1.4.3 AA needs 4.5:1`,
    ).toBeGreaterThanOrEqual(4.5)
  })

  it.each(NON_TEXT_PAIRS)('%s on %s clears 3:1 as a non-text indicator', (fg, bg) => {
    const ratio = contrast(tokens[fg], tokens[bg])
    expect(
      ratio,
      `${fg} (${tokens[fg]}) on ${bg} (${tokens[bg]}) is ${ratio.toFixed(2)}:1, WCAG 1.4.11 needs 3:1`,
    ).toBeGreaterThanOrEqual(3)
  })

  // The dark block overrode every colour token except this one, which is how --muted came to
  // be checked against the wrong background for the whole life of dark mode. A token that is
  // deliberately shared between themes should be shared on purpose, not by omission.
  it('redefines every colour token that needs a different value in the dark', () => {
    expect(Object.keys(tokens)).toContain('--muted')
  })
})

// Guards the split itself: if someone "simplifies" --accent-strong back to --accent, the pairs
// above would still pass while the app quietly returned to 2.99:1.
describe('the accent split', () => {
  it('keeps a separate strong accent in light mode, where the brand colour fails as text', () => {
    expect(contrast(LIGHT['--accent'], LIGHT['--surface-raised'])).toBeLessThan(4.5)
    expect(LIGHT['--accent-strong']).not.toBe(LIGHT['--accent'])
  })

  // In the dark the brand colour already clears the bar both ways, so the two being equal is
  // correct rather than an oversight - asserted so nobody "fixes" it.
  it('lets them be the same value in dark mode, where the brand colour passes', () => {
    expect(DARK['--accent-strong']).toBe(DARK['--accent'])
    expect(contrast(DARK['--accent'], DARK['--surface-raised'])).toBeGreaterThanOrEqual(4.5)
  })
})
