import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { KubernetesWorkspace } from './KubernetesWorkspace'
import { kubernetesDraftKey, kubernetesSecretKey } from '../kubernetes'

// The API secret is the one value on this pill that is a secret by construction rather than by
// accident, so where it goes is worth pinning from both directions: it must reach sessionStorage
// (or a reload loses it, which pushes people to keep it somewhere worse) and it must never reach
// localStorage (which outlives the tab and the browser session entirely).
const SECRET = 'ghp_SUPERSECRET123'
const draftKey = `yaml-config-generator:${kubernetesDraftKey()}`
const secretKey = `yaml-config-generator:${kubernetesSecretKey()}`

function fillIn({ secret = SECRET } = {}) {
  const view = render(<KubernetesWorkspace />)
  fireEvent.change(screen.getByRole('textbox', { name: 'Tenant' }), { target: { value: 'acme' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Product' }), { target: { value: 'widgets' } })
  if (secret) fireEvent.change(screen.getByRole('textbox', { name: 'API secret' }), { target: { value: secret } })
  return view
}

const output = () => document.querySelector('.yaml-editor-fallback')?.textContent ?? ''

describe('the Kubernetes API secret', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('is held in sessionStorage and never in localStorage', () => {
    fillIn()

    expect(sessionStorage.getItem(secretKey)).toContain(SECRET)
    expect(localStorage.getItem(draftKey)).not.toContain(SECRET)
    // Not just "not under that key" - nowhere in localStorage at all.
    expect(Object.keys(localStorage).map((k) => localStorage.getItem(k) ?? '').join('\n')).not.toContain(SECRET)
    expect(JSON.parse(localStorage.getItem(draftKey) ?? '{}')).toEqual({ tenant: 'acme', product: 'widgets' })
  })

  it('survives a reload within the tab', () => {
    fillIn().unmount()
    render(<KubernetesWorkspace />)

    expect(screen.getByRole('textbox', { name: 'API secret' })).toHaveValue(SECRET)
    // ...and the two localStorage-backed values came back too, from the other store.
    expect(screen.getByRole('textbox', { name: 'Tenant' })).toHaveValue('acme')
  })

  it('renders an Opaque Secret carrying the value as stringData, not base64', () => {
    fillIn()

    expect(output()).toContain('name: acme-widgets-api')
    expect(output()).toContain('type: Opaque')
    expect(output()).toContain('stringData:')
    expect(output()).toContain(`api_secret: ${SECRET}`)
    // base64 would look protected while being just as readable; the comment says so in the output.
    expect(output()).not.toContain(btoa(SECRET))
    expect(output()).toContain('must NOT be committed')
  })

  it('omits the Secret entirely when the field is blank', () => {
    fillIn({ secret: '' })

    expect(output()).toContain('kind: Namespace')
    expect(output()).not.toContain('acme-widgets-api')
    expect(output()).not.toContain('type: Opaque')
    // An empty stringData would overwrite a real secret already in the cluster with nothing.
    expect(output()).not.toContain('stringData')
  })

  it('turns off autofill, spellcheck and autocorrect on the input', () => {
    fillIn({ secret: '' })
    const input = screen.getByRole('textbox', { name: 'API secret' })

    expect(input).toHaveAttribute('autocomplete', 'off')
    expect(input).toHaveAttribute('autocorrect', 'off')
    expect(input).toHaveAttribute('spellcheck', 'false')
  })

  describe('Clear API secret', () => {
    const button = () => screen.getByRole('button', { name: 'Clear API secret' })

    it('is disabled while there is nothing to clear', () => {
      fillIn({ secret: '' })
      expect(button()).toBeDisabled()
      fireEvent.change(screen.getByRole('textbox', { name: 'API secret' }), { target: { value: SECRET } })
      expect(button()).toBeEnabled()
    })

    it('removes it from the field, the output and the tab, and says so', () => {
      fillIn()
      expect(output()).toContain(SECRET)

      fireEvent.click(button())

      expect(screen.getByRole('textbox', { name: 'API secret' })).toHaveValue('')
      expect(output()).not.toContain(SECRET)
      expect(screen.getByText('Cleared from this tab and removed from the page.')).toBeInTheDocument()
      // The tenant and product are not secrets and are not collateral.
      expect(screen.getByRole('textbox', { name: 'Tenant' })).toHaveValue('acme')
    })

    it('removes the key rather than leaving an emptied blob behind', () => {
      fillIn()
      fireEvent.click(button())

      expect(sessionStorage.getItem(secretKey)).toBeNull()
      expect(Object.keys(sessionStorage)).not.toContain(secretKey)
    })

    it('does not come back on the next reload', () => {
      const view = fillIn()
      fireEvent.click(button())
      view.unmount()

      render(<KubernetesWorkspace />)
      expect(screen.getByRole('textbox', { name: 'API secret' })).toHaveValue('')
    })
  })
})
