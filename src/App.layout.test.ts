import { describe, expect, it } from 'vitest'
import css from './App.css?raw'

// **What this can and cannot prove.** jsdom performs no layout - every element is 0x0 and
// nothing overflows anything - so no test here can assert that the panel actually scrolls. What
// it can do is assert that the declarations scrolling depends on are still present, which is
// the part that got deleted or "simplified" in the first place. Confirming the behaviour is a
// manual step, written down in docs/accessibility.md.
//
// The bug these guard: .yaml-panel is a sticky flex column with a max-height, and
// .yaml-editor-host used to be `flex: 1` with a hard `min-height: 240px`. A flex item will not
// shrink below its min-height, so once the panel's contents exceeded max-height the overflow
// was laid out past the panel's bottom edge with no scroll container anywhere - it simply ran
// off the box and over whatever was beneath. The Kubernetes pill showed it worst: an extra
// warning paragraph eating the height, and about a hundred lines of manifests.

/**
 * Every declaration that applies to `selector`, from every rule whose selector list names it -
 * concatenated, because CSS cascades and a property can be set in one rule and overridden in
 * another (`.yaml-panel` is declared twice: once normally and once inside the 860px media
 * query). Matching only the first rule found would make this test pass or fail on the order the
 * file happens to be written in.
 *
 * Comments are stripped first - they contain commas and braces - and only innermost blocks are
 * matched, which skips the `@media` wrappers and picks up the rules inside them.
 */
function rule(selector: string): string {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const bodies: string[] = []
  for (const match of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(',').map((part) => part.trim())
    if (selectors.includes(selector)) bodies.push(match[2])
  }
  if (bodies.length === 0) throw new Error(`App.css no longer has a \`${selector}\` rule - update this test alongside it`)
  return bodies.join('\n')
}

describe('the YAML panel can scroll', () => {
  it('clips the sticky panel, so nothing is laid out past its edge', () => {
    expect(rule('.yaml-panel')).toMatch(/overflow:\s*hidden/)
  })

  it('still caps the panel to the viewport', () => {
    // Without the cap there is nothing to overflow and nothing to scroll - the panel would
    // simply grow, which is the other way to "fix" this and loses the sticky behaviour.
    expect(rule('.yaml-panel')).toMatch(/max-height:\s*calc\(100vh/)
    expect(rule('.yaml-panel')).toMatch(/position:\s*sticky/)
  })

  it.each(['.yaml-editor-host', '.yaml-editor-fallback'])('lets %s shrink inside it', (selector) => {
    const body = rule(selector)
    // min-height: 0 is the whole fix. A flex item's min-height defaults to auto, and the old
    // hard 240px floor is what stopped it shrinking.
    expect(body, `${selector} needs min-height: 0 to be allowed to shrink`).toMatch(/min-height:\s*0\b/)
    // basis rather than floor: opens at a usable size, grows into spare room, shrinks when
    // there is none.
    expect(body, `${selector} should keep a flex-basis so it still opens at a usable size`).toMatch(
      /flex:\s*1\s+1\s+240px/,
    )
  })

  it('keeps the editor from scroll-chaining the page once it bottoms out', () => {
    expect(rule('.yaml-editor-host')).toMatch(/overscroll-behavior:\s*contain/)
  })
})

describe('inline code cannot widen the page', () => {
  // A file path and a shell command are single unbreakable tokens. Left to themselves they push
  // their container wider than the column and the whole document gains a horizontal scrollbar,
  // which WCAG 1.4.10 rules out at 320px-equivalent width. Each scrolls in its own box instead.
  it.each(['.github-path code', '.step-command code'])('%s scrolls in its own box', (selector) => {
    const body = rule(selector)
    expect(body).toMatch(/overflow-x:\s*auto/)
    expect(body).toMatch(/max-width:\s*100%/)
  })

  it('lets the command row be narrower than its content, or the above does nothing', () => {
    // An inline-flex item's default min-width is auto - the same trap as min-height above.
    expect(rule('.step-command')).toMatch(/min-width:\s*0\b/)
  })
})

describe('the focus indicator', () => {
  // One ring for the whole app, on :focus-visible rather than :focus so it appears for keyboard
  // and assistive-tech users without ringing every mouse click. The pills, the text fields and
  // everything else share it; only .theme-switch adds its own, because its radios are clipped
  // out of sight and the ring has to go on the strip instead of on the invisible input.
  it('is a single :focus-visible rule the pills and the text fields both use', () => {
    const body = rule(':focus-visible')
    expect(body).toMatch(/outline:\s*2px solid var\(--accent-strong\)/)
    expect(body).toMatch(/outline-offset:\s*2px/)
  })

  // The bug this guards: an outline already follows the element's own border curve, so a
  // border-radius here buys nothing - and on a blanket rule it *replaces* the element's radius
  // while focused. .config-tab is border-radius: 999px, so it snapped from a capsule to an 8px
  // rounded rectangle on focus, which reads as the layout glitching, not as a focus ring.
  it('does not restyle the shape of whatever has focus', () => {
    expect(rule(':focus-visible')).not.toMatch(/border-radius/)
  })

  it('is re-stated in a system colour for forced-colors mode', () => {
    // Windows High Contrast replaces the palette outright, including outline colours, so the
    // ring has to name a colour that mode actually honours or it disappears entirely.
    expect(css).toMatch(/@media \(forced-colors: active\)[\s\S]{0,200}outline:[^;]*Highlight/)
  })

  it('gives the theme switch its own ring, since its radios are visually clipped', () => {
    expect(rule('.theme-switch:focus-within')).toMatch(/outline:\s*2px solid var\(--accent-strong\)/)
  })
})
