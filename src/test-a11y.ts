import axe, { type AxeResults, type RunOptions } from 'axe-core'
import { expect } from 'vitest'

// axe-core driven directly rather than through jest-axe/vitest-axe. Those wrappers exist to
// supply a `toHaveNoViolations` matcher and a jsdom shim; the matcher is ~15 lines (below) and
// the shim is what `configureAxe` does here, so a wrapper would be a dependency carrying a
// version skew risk for code this repo can read in one screen. Same reasoning as the workflows
// running each tool's own binary instead of a wrapper action.
//
// **What this does and does not prove.** axe finds machine-checkable failures: a control with
// no accessible name, insufficient contrast between two known colours, an ARIA attribute on an
// element that can't carry it, a heading level skipped. It cannot tell you whether a label
// *reads* sensibly, whether focus order matches the visual order, or whether an aria-live
// region fires at a useful moment. Roughly a third of WCAG is machine-checkable at all. Treat a
// pass as "no known defects", never as "accessible" - the manual checks in
// docs/accessibility.md are the other half.
//
// Two rules are turned off globally, both for jsdom rather than for convenience:
//
// - `color-contrast` needs real layout and computed styles. jsdom applies no stylesheet, so
//   every element resolves to transparent-on-transparent and axe either skips it as
//   incomplete or reports nonsense. The palette's contrast ratios are checked once, against
//   the CSS custom properties themselves, in App.contrast.test.ts - which is the honest place
//   for it, since they are constants rather than something a render can change.
// - `region` (all content inside a landmark) fires on every component test, because a test
//   renders one component into a bare <div> rather than the page that supplies <main>. It is
//   asserted where it is actually meaningful, on the full App render.
const JSDOM_DISABLED = {
  'color-contrast': { enabled: false },
  region: { enabled: false },
} satisfies RunOptions['rules']

export interface A11yOptions {
  /** Re-enable a rule disabled above, or disable another, for one call. */
  rules?: RunOptions['rules']
}

export async function axeViolations(container: Element, options: A11yOptions = {}): Promise<AxeResults['violations']> {
  const results = await axe.run(container, {
    rules: { ...JSDOM_DISABLED, ...options.rules },
    // WCAG 2.2 AA is the bar this project holds itself to (docs/accessibility.md). best-practice
    // is included deliberately: it is where "every list item is inside a list" and the landmark
    // rules live, and those catch structural mistakes long before a user does.
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
  })
  return results.violations
}

/**
 * Fails with axe's own summary - the rule id, the plain-English description, and the offending
 * HTML - rather than "expected 3 to be 0", which sends the reader off to reproduce it by hand.
 */
export async function expectNoA11yViolations(container: Element, options: A11yOptions = {}): Promise<void> {
  const violations = await axeViolations(container, options)
  if (violations.length === 0) return
  const report = violations
    .map((v) => {
      const nodes = v.nodes.map((n) => `      ${n.html}`).join('\n')
      return `  [${v.impact}] ${v.id}: ${v.help}\n    ${v.helpUrl}\n${nodes}`
    })
    .join('\n\n')
  expect.fail(`${violations.length} accessibility violation(s):\n\n${report}`)
}
