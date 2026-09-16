import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { KubernetesWorkspace } from './KubernetesWorkspace'

// Same substitution as ConfigWorkspace.test.tsx - CodeMirror's contenteditable isn't reliably
// driven under jsdom. Here it also has to honour readOnly, since that's the prop this pill
// depends on: the manifests are rendered output, not a document to edit.
vi.mock('./YamlEditor', () => ({
  default: ({ value, placeholder, readOnly }: { value: string; placeholder?: string; readOnly?: boolean }) => (
    <textarea data-testid="yaml-field" value={value} placeholder={placeholder} readOnly={readOnly} onChange={() => {}} />
  ),
}))

function fill(tenant = 'acme', product = 'widgets') {
  fireEvent.change(screen.getByPlaceholderText('acme'), { target: { value: tenant } })
  fireEvent.change(screen.getByPlaceholderText('product name'), { target: { value: product } })
}

async function yamlField() {
  return (await screen.findByTestId('yaml-field')) as HTMLTextAreaElement
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

describe('KubernetesWorkspace', () => {
  it('asks for both inputs before rendering anything', async () => {
    render(<KubernetesWorkspace />)

    expect(await screen.findByText(/Enter a tenant and a product/)).toBeInTheDocument()
    expect((await yamlField()).value).toBe('')
    expect(screen.getByRole('button', { name: 'Copy all' })).toBeDisabled()
  })

  it('renders every resource once both inputs are filled', async () => {
    render(<KubernetesWorkspace />)
    const field = await yamlField()

    fill()

    expect(field.value).toContain('kind: Namespace')
    expect(field.value).toContain('name: acme-widgets')
    expect(field.value).toContain('kind: Role')
    expect(field.value).toContain('kind: RoleBinding')
    expect(field.value).toContain('kind: ServiceAccount')
    expect(field.value).toContain('kind: Secret')
  })

  it('is output, not a document to edit', async () => {
    render(<KubernetesWorkspace />)
    fill()

    expect(await yamlField()).toHaveAttribute('readonly')
  })

  it('surfaces an invalid Kubernetes name instead of emitting broken YAML', async () => {
    render(<KubernetesWorkspace />)
    const field = await yamlField()

    fill('Acme', 'widgets')

    expect(screen.getByText(/isn't a valid Kubernetes name/)).toBeInTheDocument()
    expect(field.value).toBe('')
    expect(screen.getByRole('button', { name: 'Copy all' })).toBeDisabled()
  })

  it('copies the whole stream and says what to do with it', async () => {
    render(<KubernetesWorkspace />)
    const field = await yamlField()
    fill()

    fireEvent.click(screen.getByRole('button', { name: 'Copy all' }))

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(field.value)
    expect(screen.getByText(/kubectl apply -f -/)).toBeInTheDocument()
  })

  it('keeps the placeholder warning visible on the page as well as in the YAML', async () => {
    render(<KubernetesWorkspace />)
    fill()

    expect(screen.getByText(/Placeholder\./)).toBeInTheDocument()
    expect((await yamlField()).value).toContain('# PLACEHOLDER')
  })

  it('picks up inputs seeded from the onboarding checklist', async () => {
    localStorage.setItem('yaml-config-generator:draft:kubernetes', JSON.stringify({ tenant: 'globex', product: 'gadgets' }))

    render(<KubernetesWorkspace />)

    expect((await yamlField()).value).toContain('name: globex-gadgets')
  })

  it('persists what was typed across a remount', async () => {
    const { unmount } = render(<KubernetesWorkspace />)
    fill('globex', 'gadgets')
    unmount()

    render(<KubernetesWorkspace />)
    expect((await yamlField()).value).toContain('name: globex-gadgets')
  })
})
