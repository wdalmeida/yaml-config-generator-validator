import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from './App'
import { ConfigWorkspace } from './components/ConfigWorkspace'
import { KubernetesWorkspace } from './components/KubernetesWorkspace'
import { CONFIG_DEFINITIONS } from './configs'
import { NAV_ENTRIES } from './nav'
import { expectNoA11yViolations } from './test-a11y'

// The runtime half of this project's accessibility checks. oxlint's jsx-a11y plugin reads the
// source and catches what is wrong in one element - a missing alt, an aria attribute that
// element can't carry. It cannot see the rendered tree, which is where the interesting failures
// live: FieldRow's label was a sibling <label> with no htmlFor, so it named nothing, and every
// non-compact control in the app was anonymous. jsx-a11y did not report it (its
// label-has-associated-control does fire on the same shape written inline, but not through the
// helper function), and nothing else would have.
//
// These run axe over the real component trees. See src/test-a11y.ts for the two rules disabled
// under jsdom and why, and docs/accessibility.md for what a passing run does not prove.
describe('accessibility', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  // The whole page, including the landmark structure and the skip link, which only exist here.
  // `region` is re-enabled for this one: it is the assertion that every piece of content sits
  // inside a landmark, and this is the only render where that question is meaningful.
  it('the full app has no violations, landmarks included', async () => {
    const { container } = render(<App />)
    await expectNoA11yViolations(container, { rules: { region: { enabled: true } } })
  })

  // Every pill, not just the default one. A workspace is only mounted when its pill is
  // selected, so a violation in a type nobody opened would otherwise reach main unnoticed -
  // the same reason ci.yml renders every charts/*/ci/*-values.yaml rather than the defaults.
  it.each(NAV_ENTRIES.map((e) => e.id))('the %s pill has no violations', async (id) => {
    localStorage.setItem('yaml-config-generator:selected-config-id', JSON.stringify(id))
    const { container } = render(<App />)
    await expectNoA11yViolations(container)
  })

  // Config types are data - dropping in a .schema.json file is the whole integration - so this
  // iterates the registry rather than naming five. A sixth schema is covered the day it lands.
  it.each(CONFIG_DEFINITIONS.map((d) => [d.id, d] as const))(
    '%s renders an accessible form',
    async (_id, definition) => {
      const { container } = render(<ConfigWorkspace definition={definition} />)
      await expectNoA11yViolations(container)
    },
  )

  it('the Kubernetes pill has no violations with invalid input showing', async () => {
    const { container } = render(<KubernetesWorkspace />)
    await expectNoA11yViolations(container)
  })

  // The specific defect this suite was written for, asserted by name rather than only through
  // axe's aggregate: every control on the busiest screen in the app resolves to a real name.
  it('names every control on the tenant-config form', () => {
    const definition = CONFIG_DEFINITIONS.find((d) => d.id === 'tenant-config')
    if (!definition) throw new Error('tenant-config schema is missing')
    render(<ConfigWorkspace definition={definition} />)

    const controls = Array.from(document.querySelectorAll('input, select, textarea'))
    expect(controls.length).toBeGreaterThan(5)
    const unnamed = controls.filter((el) => {
      const id = el.getAttribute('id')
      return !(
        (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) ||
        el.closest('label') ||
        el.getAttribute('aria-label') ||
        el.getAttribute('aria-labelledby') ||
        // A control inside a <fieldset> is named by its own label or aria-label; the legend
        // names the group, not the control, so it deliberately does not count here.
        false
      )
    })
    expect(unnamed.map((el) => el.outerHTML)).toEqual([])
  })

  // Colour is not the only carrier of the pill's state. The dot is aria-hidden by design, so
  // the text beside it is the only thing an assistive technology has to go on.
  it('states each pill status in text, not only in the dot colour', () => {
    render(<App />)
    const pills = screen.getAllByRole('button', { name: /not started|in progress|valid/ })
    expect(pills).toHaveLength(NAV_ENTRIES.length)
  })

  // Which pill is open was conveyed only by a CSS class before this.
  it('marks the open pill as current', () => {
    render(<App />)
    const current = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-current') === 'page')
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveTextContent(NAV_ENTRIES[0].label)
  })
})
