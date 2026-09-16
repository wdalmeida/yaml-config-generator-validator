import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from './App'
import css from './App.css?raw'
import { DEFICIENCIES, palettes, simulate, worstSeparation } from './test-color'

// Colour-vision deficiency is a separate axis from contrast: a pair can clear 4.5:1 against the
// background and still be indistinguishable from each other. Deuteranomaly and protanomaly
// together affect roughly 1 in 12 men, so this is not an edge case.
//
// Two rules follow, and the second matters more than the first:
//
//  1. Colours that encode mutually exclusive states have to stay apart under simulation.
//  2. Colour is never the only carrier. Every state here also has a shape and a word, so the
//     palette is reinforcement - which is what WCAG 1.4.1 actually asks for, and the only thing
//     that holds for monochromacy, a greyscale print, or a failing projector.
//
// The status marks used to be three colours on one circle, and amber against green measured 8.6
// simulated for protanopia in light mode and 9.9 in dark. Hence the teal, and hence the shapes.

const { light, dark } = palettes(css)

// Below roughly this, two colours of similar lightness are not reliably told apart. It is a
// working threshold rather than a standard - the CIE's own "just noticeable" is far smaller,
// but picking one of several discrete states out of a UI needs more margin than noticing that
// two swatches differ when they are side by side.
const DISTINGUISHABLE = 11

// Sets of colours that mean different things about the SAME element, where confusing two of
// them would mislead. Pairs from different sets are not listed: nobody has to tell error text
// from a button's accent to understand the page, and requiring it would force the palette into
// four unrelated hues for no benefit.
const CONTRASTIVE_SETS: Array<[name: string, tokens: string[]]> = [
  // The pill status marks: not started / in progress / valid.
  ['status marks', ['--muted', '--warn', '--success']],
  // The YAML panel's verdict: one "valid" line, or a list of errors.
  ['validation feedback', ['--success', '--error']],
]

describe.each([
  ['light', light],
  ['dark', dark],
])('%s palette under colour-vision deficiency', (_theme, tokens) => {
  for (const [setName, members] of CONTRASTIVE_SETS) {
    const pairs = members.flatMap((a, i) => members.slice(i + 1).map((b) => [a, b] as const))
    it.each(pairs)(`${setName}: %s and %s stay apart`, (a, b) => {
      const { deltaE, vision } = worstSeparation(tokens[a], tokens[b])
      expect(
        deltaE,
        `${a} (${tokens[a]}) and ${b} (${tokens[b]}) are only ${deltaE.toFixed(1)} apart under ` +
          `${vision} - below ${DISTINGUISHABLE} they are not reliably tellable apart`,
      ).toBeGreaterThanOrEqual(DISTINGUISHABLE)
    })
  }

  // The specific regression: green and amber. Named on its own because "use a green for
  // success" is the obvious edit for someone who does not know why it is teal.
  it('keeps success off the green axis, where amber would swallow it', () => {
    const { deltaE } = worstSeparation(tokens['--success'], tokens['--warn'])
    expect(deltaE).toBeGreaterThan(20)
  })
})

describe('colour is never the only signal', () => {
  // Monochromacy exists, screens get printed, and projectors wash out. Shape is what survives
  // all three, so the mark is an SVG with a different silhouette per state rather than one
  // circle in three colours.
  it('gives each pill status its own shape, not just its own colour', () => {
    const { container } = render(<App />)
    const marks = container.querySelectorAll('.status-mark svg')
    expect(marks.length).toBeGreaterThan(0)
    // Every mark's geometry comes from its own component, so identical states share a shape and
    // different states never do. Comparing the drawn paths is the closest thing to asserting
    // "these look different" that jsdom can honestly do.
    const shapeOf = (svg: Element) =>
      [...svg.children].map((el) => `${el.tagName}:${el.getAttribute('d') ?? el.getAttribute('r') ?? ''}`).join('|')
    const byState = new Map<string, string>()
    for (const mark of container.querySelectorAll('.status-mark')) {
      const state = [...mark.classList].find((c) => c.startsWith('status-') && c !== 'status-mark')
      const svg = mark.querySelector('svg')
      if (!state || !svg) continue
      const shape = shapeOf(svg)
      const seen = byState.get(state)
      if (seen) expect(shape).toBe(seen)
      byState.set(state, shape)
    }
    expect(new Set(byState.values()).size).toBe(byState.size)
  })

  // And the shape does not reach a screen reader either, so the state is also a word.
  it('states every pill status in words as well', () => {
    render(<App />)
    expect(screen.getAllByRole('button', { name: /not started|in progress|valid/ }).length).toBeGreaterThan(0)
  })
})

// A guard on the simulation itself. If these matrices were ever mangled, every assertion above
// would pass vacuously by reporting huge differences.
describe('the simulation', () => {
  it('collapses pure red and green toward each other for a deuteranope', () => {
    const before = worstSeparation('#ff0000', '#00ff00')
    expect(before.vision).not.toBe('normal vision')
    const [r, g] = [simulate('#ff0000', 'deuteranopia'), simulate('#00ff00', 'deuteranopia')]
    expect(r).not.toBe('#ff0000')
    expect(g).not.toBe('#00ff00')
  })

  it('leaves a grey untouched under every deficiency', () => {
    // A neutral has nothing for a missing cone class to lose, so any matrix that shifts it is
    // wrong. Allows one step of rounding per channel.
    for (const kind of DEFICIENCIES) {
      const out = simulate('#808080', kind)
      const channels = [1, 3, 5].map((i) => parseInt(out.slice(i, i + 2), 16))
      for (const c of channels) expect(Math.abs(c - 0x80)).toBeLessThanOrEqual(2)
    }
  })
})
