import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { KubernetesWorkspace } from './KubernetesWorkspace'
import { kubernetesDraftKey } from '../kubernetes'

// The rendered manifests are never written to localStorage, and this is what keeps it that way.
//
// It is worth an explicit test because the property is a consequence of how the component is
// built rather than anything that announces itself: `renderManifests(draft)` is called on every
// render from the two inputs, and only those two inputs are persisted. Nothing in the code says
// "do not persist the output", so the obvious refactor - memoising the manifests into
// usePersistedState to avoid re-rendering them - would quietly break it and no other test would
// notice.
//
// Why it matters: the stream contains ServiceAccount token Secrets. They are placeholders today
// (every one marked `# TODO: confirm`), but the shape invites someone to paste a real token in
// before applying, and browser storage is readable by any script on the origin, survives the tab
// closing, and is trivially dumped from devtools. The two inputs are a tenant and a product
// name, which are not secrets by any reading.
//
// The related exposure that is NOT covered here, because it is a product decision rather than a
// bug: a ConfigWorkspace persists its draft, and its YAML field accepts paste, so anything typed
// or pasted there does reach localStorage. That is the documented "switching types never loses
// work" behaviour. See docs/accessibility.md's sibling note in README if that ever changes.
describe('KubernetesWorkspace storage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  function fillIn() {
    render(<KubernetesWorkspace />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Tenant' }), { target: { value: 'acme' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Product' }), { target: { value: 'widgets' } })
  }

  const storedValues = () => Object.keys(localStorage).map((k) => localStorage.getItem(k) ?? '')

  it('persists the two inputs and nothing else', () => {
    fillIn()
    expect(Object.keys(localStorage)).toEqual([`yaml-config-generator:${kubernetesDraftKey()}`])
    expect(JSON.parse(localStorage.getItem(`yaml-config-generator:${kubernetesDraftKey()}`) ?? '{}')).toEqual({
      tenant: 'acme',
      product: 'widgets',
    })
  })

  it('never writes the rendered manifests to storage', () => {
    fillIn()
    // Proof the manifests really were rendered - otherwise this passes by rendering nothing.
    const output = document.querySelector('.yaml-editor-fallback')?.textContent ?? ''
    expect(output).toContain('kind: ServiceAccount')
    expect(output.length).toBeGreaterThan(500)

    for (const marker of ['ServiceAccount', 'kind: Secret', 'apiVersion', 'RoleBinding', '# TODO: confirm']) {
      expect(storedValues().join('\n'), `"${marker}" reached localStorage`).not.toContain(marker)
    }
  })

  it('keeps the output field read-only, so nothing can be pasted into it in the first place', () => {
    fillIn()
    const output = document.querySelector('.yaml-editor-fallback')
    expect(output).toHaveAttribute('readonly')
  })
})
