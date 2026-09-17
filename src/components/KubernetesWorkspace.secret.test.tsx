import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { KubernetesWorkspace } from './KubernetesWorkspace'
import { kubernetesDraftKey, MASKED_SECRET } from '../kubernetes'

// The API secret is the one value on this pill that is a secret by construction rather than by
// accident, and the promise about it is the strongest one available to a page: it is held in
// component state and written to no store at all.
//
// sessionStorage was built for this value first and then removed. It is readable by any script on
// the origin for as long as the tab is open, so against the threat that actually matters - a
// compromised dependency, an injected script, anything else running on the page - it offers no
// protection, and all it adds is a window during which the value sits somewhere enumerable by key.
// The price of the stricter answer is that a reload loses the secret; that is a deliberate,
// user-made trade, and the tests below pin both halves of it so neither can be softened quietly.
const SECRET = 'ghp_SUPERSECRET123'
const draftKey = `yaml-config-generator:${kubernetesDraftKey()}`

function fillIn({ secret = SECRET } = {}) {
  const view = render(<KubernetesWorkspace />)
  fireEvent.change(screen.getByRole('textbox', { name: 'Tenant' }), { target: { value: 'acme' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Product' }), { target: { value: 'widgets' } })
  // getByLabelText, not getByRole('textbox'): the field is type="password" while masked, and a
  // password input deliberately exposes no textbox role.
  if (secret) fireEvent.change(secretInput(), { target: { value: secret } })
  return view
}

const secretInput = () => screen.getByLabelText('API secret')
const reveal = () => screen.getByRole('button', { name: /(Show|Hide) secret/ })
const output = () => document.querySelector('.yaml-editor-fallback')?.textContent ?? ''
const dumpOf = (store: Storage) => Object.keys(store).map((k) => store.getItem(k) ?? '').join('\n')

describe('the Kubernetes API secret', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('reaches no browser store at all', () => {
    fillIn()

    // Proof it is genuinely in play - otherwise this passes by the field doing nothing.
    expect(secretInput()).toHaveValue(SECRET)
    fireEvent.click(reveal())
    expect(output()).toContain(SECRET)

    expect(dumpOf(localStorage)).not.toContain(SECRET)
    expect(dumpOf(sessionStorage)).not.toContain(SECRET)
    expect(Object.keys(sessionStorage)).toHaveLength(0)
    expect(JSON.parse(localStorage.getItem(draftKey) ?? '{}')).toEqual({
      tenant: 'acme',
      product: 'widgets',
      namespace: '',
    })
  })

  // The other half of the same decision. Losing it on reload is the cost that was accepted, so it
  // is asserted rather than left to drift back into a "convenience" cache later.
  it('is gone after a reload, while the two non-secret inputs come back', () => {
    fillIn().unmount()
    render(<KubernetesWorkspace />)

    expect(secretInput()).toHaveValue('')
    expect(screen.getByRole('textbox', { name: 'Tenant' })).toHaveValue('acme')
    expect(output()).not.toContain(SECRET)
  })

  it('tells the reader it is not saved, before they find out the hard way', () => {
    fillIn({ secret: '' })
    expect(screen.getByText(/Never saved/)).toBeInTheDocument()
  })

  it('renders an Opaque Secret carrying the value as stringData, not base64', () => {
    fillIn()
    fireEvent.click(reveal())

    expect(output()).toContain('name: acme-widgets-api')
    expect(output()).toContain('type: Opaque')
    expect(output()).toContain(`api_secret: ${SECRET}`)
    expect(output()).not.toContain(btoa(SECRET))
    expect(output()).toContain('must NOT be committed')
  })

  it('omits the Secret entirely when the field is blank', () => {
    fillIn({ secret: '' })

    expect(output()).toContain('kind: Namespace')
    expect(output()).not.toContain('acme-widgets-api')
    expect(output()).not.toContain('stringData')
  })

  it('turns off autofill, spellcheck and autocorrect on the input', () => {
    fillIn({ secret: '' })
    const input = secretInput()

    expect(input).toHaveAttribute('type', 'password')
    expect(input).toHaveAttribute('autocomplete', 'off')
    expect(input).toHaveAttribute('autocorrect', 'off')
    expect(input).toHaveAttribute('spellcheck', 'false')
  })

  // Named for the category rather than for today's single field: it clears every key marked
  // secret, so a second secret input is covered without the label becoming a lie.
  describe('Clear secrets', () => {
    const button = () => screen.getByRole('button', { name: 'Clear secrets' })


    it('is disabled while there is nothing to clear', () => {
      fillIn({ secret: '' })
      expect(button()).toBeDisabled()
      fireEvent.change(secretInput(), { target: { value: SECRET } })
      expect(button()).toBeEnabled()
    })

    // Nothing is stored, so this is about the screen: the value sits in the field and in the
    // rendered output until something removes it, and "I am about to share this screen" is the
    // case it exists for.
    it('removes it from the field and the output, and says so', () => {
      fillIn()
      fireEvent.click(reveal())
      expect(output()).toContain(SECRET)

      fireEvent.click(button())

      expect(secretInput()).toHaveValue('')
      expect(output()).not.toContain(SECRET)
      expect(screen.getByText('Cleared from the page.')).toBeInTheDocument()
      // The tenant and product are not secrets and are not collateral.
      expect(screen.getByRole('textbox', { name: 'Tenant' })).toHaveValue('acme')
    })
  })
})

describe('the namespace field', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  const namespaceInput = () => screen.getByRole('textbox', { name: 'Namespace' })

  it('shows the derived default before anything is typed, as a template rather than a bare dash', () => {
    render(<KubernetesWorkspace />)
    expect(screen.getAllByText('<tenant>-<product>').length).toBeGreaterThan(0)
  })

  it('previews the derived value live as the tenant and product are filled in', () => {
    fillIn({ secret: '' })
    expect(namespaceInput()).toHaveValue('')
    expect(screen.getAllByText('acme-widgets').length).toBeGreaterThan(0)
    expect(output()).toContain('name: acme-widgets')
  })

  it('renames every resource once a namespace is given', () => {
    fillIn({ secret: '' })
    fireEvent.change(namespaceInput(), { target: { value: 'team-platform' } })

    expect(output()).toContain('name: team-platform')
    expect(output()).toContain('name: team-platform-deployer')
    expect(output()).not.toContain('acme-widgets-')
    // ...and the tenant/product labels are untouched.
    expect(output()).toContain('tenant: acme')
  })

  it('is persisted, being a name and not a secret', () => {
    fillIn({ secret: '' })
    fireEvent.change(namespaceInput(), { target: { value: 'team-platform' } })

    expect(JSON.parse(localStorage.getItem(draftKey) ?? '{}')).toEqual({
      tenant: 'acme',
      product: 'widgets',
      namespace: 'team-platform',
    })
  })
})

// Masking the input is only worth anything if whatever renders the value masks it too - otherwise
// it is theatre, hiding the value in one box while printing it in the panel alongside. So the one
// toggle governs both, and the copy is deliberately exempt: putting `api_secret: ••••••••` on the
// clipboard would create a Secret holding literal bullets, and that failure would surface far from
// here, inside a cluster, as an application that cannot authenticate.
describe('masking the secret', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('hides it in the field and the output by default', () => {
    fillIn()

    expect(secretInput()).toHaveAttribute('type', 'password')
    expect(output()).not.toContain(SECRET)
    expect(output()).toContain('api_secret: ••••••••')
    expect(reveal()).toHaveTextContent('Show secret')
  })

  it('masks to a fixed length, so the mask does not leak the real one', () => {
    fillIn({ secret: 'x' })
    const short = output()
    fireEvent.change(secretInput(), { target: { value: 'x'.repeat(120) } })

    expect(short).toContain(MASKED_SECRET)
    expect(output()).toContain(MASKED_SECRET)
    expect(output()).toBe(short)
  })

  it('shows both once revealed, and hides both again', () => {
    fillIn()
    fireEvent.click(reveal())

    expect(secretInput()).toHaveAttribute('type', 'text')
    expect(output()).toContain(`api_secret: ${SECRET}`)
    expect(reveal()).toHaveTextContent('Hide secret')

    fireEvent.click(reveal())
    expect(secretInput()).toHaveAttribute('type', 'password')
    expect(output()).not.toContain(SECRET)
  })

  it('copies the real value while masked, and says that it did', async () => {
    fillIn()
    expect(output()).not.toContain(SECRET)

    fireEvent.click(screen.getByRole('button', { name: 'Copy all' }))

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining(`api_secret: ${SECRET}`))
    expect(navigator.clipboard.writeText).not.toHaveBeenCalledWith(expect.stringContaining(MASKED_SECRET))
    expect(await screen.findByText(/including the real secret rather than the mask/)).toBeInTheDocument()
  })

  it('starts masked again on the next visit rather than remembering the choice', () => {
    fillIn()
    fireEvent.click(reveal())
    expect(reveal()).toHaveTextContent('Hide secret')

    render(<KubernetesWorkspace />)
    expect(screen.getAllByRole('button', { name: 'Show secret' }).length).toBeGreaterThan(0)
  })

  it('offers nothing to reveal when there is no secret', () => {
    fillIn({ secret: '' })
    expect(reveal()).toBeDisabled()
    expect(output()).not.toContain(MASKED_SECRET)
  })
})
