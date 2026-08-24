import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ConfigWorkspace } from './ConfigWorkspace'
import { getConfigDefinition } from '../configs'

// CodeMirror's real DOM (contenteditable) isn't reliably driven by fireEvent.change under
// jsdom - see YamlEditor.test.tsx, which covers the real component directly. Here we replace it
// with a plain textarea sharing the exact same props contract, so these tests exercise
// ConfigWorkspace's own bidirectional sync logic (the thing actually under test) without
// depending on CodeMirror's internals. React.lazy/Suspense still applies to the mocked module,
// so tests that need the field must await its first appearance.
vi.mock('./YamlEditor', () => ({
  default: ({
    value,
    onChange,
    onFocus,
    onBlur,
    placeholder,
  }: {
    value: string
    onChange: (value: string) => void
    onFocus?: () => void
    onBlur?: () => void
    placeholder?: string
  }) => (
    <textarea
      data-testid="yaml-field"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onFocus={onFocus}
      onBlur={onBlur}
    />
  ),
}))

const tenantConfigDefinition = getConfigDefinition('tenant-config')

const validYaml = [
  'tenant: acme',
  'product: checkout',
  'proxyEntries:',
  '  - "*.github.com"',
  'githubTopics:',
  '  - method: artefact',
  '    name: billing',
  '    description: Billing service',
  '',
].join('\n')

// The filename isn't part of this: it's fixed to the definition's default and has no input.
function fillTargetFile({ owner = 'acme-co', repo = 'infra' } = {}) {
  fireEvent.change(screen.getByPlaceholderText('owner'), { target: { value: owner } })
  fireEvent.change(screen.getByPlaceholderText('repo'), { target: { value: repo } })
}

async function yamlField() {
  return (await screen.findByTestId('yaml-field')) as HTMLTextAreaElement
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ConfigWorkspace', () => {
  it('fills in every field and reflects them live in the YAML field', async () => {
    render(<ConfigWorkspace definition={tenantConfigDefinition} />)

    fireEvent.change(screen.getByPlaceholderText('product name'), { target: { value: 'checkout' } })
    fireEvent.change(screen.getByPlaceholderText('*.github.com'), { target: { value: '*.github.com' } })
    fireEvent.change(screen.getByPlaceholderText('name'), { target: { value: 'billing' } })
    fireEvent.change(screen.getByPlaceholderText('description'), { target: { value: 'Billing service' } })

    expect(await yamlField()).toHaveValue(validYaml)
  })

  it('shows validation errors and an empty field when required fields are still blank', async () => {
    render(<ConfigWorkspace definition={tenantConfigDefinition} />)

    const yamlSection = screen.getByRole('heading', { name: 'YAML' }).closest('section')!
    expect(within(yamlSection).getByRole('list')).toBeInTheDocument()
    expect(await yamlField()).toHaveValue('')
  })

  it('typing valid YAML directly into the field syncs it into the form', async () => {
    render(<ConfigWorkspace definition={tenantConfigDefinition} />)

    fireEvent.change(await yamlField(), { target: { value: validYaml } })

    expect(screen.getByText('✓ Valid — synced to form')).toBeInTheDocument()
    expect((screen.getByPlaceholderText('product name') as HTMLInputElement).value).toBe('checkout')
    // The field itself keeps showing what was typed - it isn't cleared once synced.
    expect(await yamlField()).toHaveValue(validYaml)
  })

  it('typing invalid YAML shows errors and leaves the form untouched', async () => {
    render(<ConfigWorkspace definition={tenantConfigDefinition} />)

    fireEvent.change(await yamlField(), { target: { value: 'tenant: [unterminated' } })

    expect(screen.getByText(/YAML syntax error/)).toBeInTheDocument()
    expect((screen.getByPlaceholderText('product name') as HTMLInputElement).value).toBe('')
  })

  it('does not overwrite the field mid-edit when the field is focused', async () => {
    render(<ConfigWorkspace definition={tenantConfigDefinition} />)

    const field = await yamlField()
    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: 'tenant: [unterminated' } })
    // A field-driven draft change happens elsewhere while the yaml field is focused - it must
    // not clobber the invalid text the user is actively editing.
    fireEvent.change(screen.getByPlaceholderText('product name'), { target: { value: 'checkout' } })

    expect(field).toHaveValue('tenant: [unterminated')
  })

  it('states the filename instead of offering it as an editable field', () => {
    render(<ConfigWorkspace definition={tenantConfigDefinition} />)

    expect(screen.getByText(tenantConfigDefinition.defaultFilename)).toBeInTheDocument()
    // Only owner/repo/branch are inputs - there is no way to retarget the filename.
    const targetSection = screen.getByRole('heading', { name: 'Target file on GitHub' }).closest('section')!
    expect(within(targetSection).getAllByRole('textbox')).toHaveLength(3)
  })

  it('prefills owner and repo from the URL when served from GitHub Pages', () => {
    vi.stubGlobal('location', new URL('https://acme.github.io/widget-service/'))

    render(<ConfigWorkspace definition={tenantConfigDefinition} />)

    expect(screen.getByPlaceholderText('owner')).toHaveValue('acme')
    expect(screen.getByPlaceholderText('repo')).toHaveValue('widget-service')
  })

  it('leaves owner and repo blank when served from anywhere else', () => {
    vi.stubGlobal('location', new URL('http://localhost:8080/'))

    render(<ConfigWorkspace definition={tenantConfigDefinition} />)

    expect(screen.getByPlaceholderText('owner')).toHaveValue('')
    expect(screen.getByPlaceholderText('repo')).toHaveValue('')
  })

  it('keeps an edited owner/repo over the Pages-derived default', () => {
    vi.stubGlobal('location', new URL('https://acme.github.io/widget-service/'))

    const { unmount } = render(<ConfigWorkspace definition={tenantConfigDefinition} />)
    fireEvent.change(screen.getByPlaceholderText('repo'), { target: { value: 'other-service' } })
    unmount()

    render(<ConfigWorkspace definition={tenantConfigDefinition} />)
    expect(screen.getByPlaceholderText('repo')).toHaveValue('other-service')
  })

  it('Fetch from GitHub loads the file content into the field and syncs the form', async () => {
    const content = btoa(String.fromCharCode(...new TextEncoder().encode(validYaml)))
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ status: 200, json: () => Promise.resolve({ content, encoding: 'base64' }) } as Response)),
    )

    render(<ConfigWorkspace definition={tenantConfigDefinition} />)
    fillTargetFile()
    fireEvent.click(screen.getByRole('button', { name: 'Fetch from GitHub' }))

    await waitFor(async () => expect(await yamlField()).toHaveValue(validYaml))
    expect((screen.getByPlaceholderText('product name') as HTMLInputElement).value).toBe('checkout')
  })

  it('Fetch from GitHub shows an error when the file cannot be fetched', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ status: 404 } as Response)))

    render(<ConfigWorkspace definition={tenantConfigDefinition} />)
    fillTargetFile()
    fireEvent.click(screen.getByRole('button', { name: 'Fetch from GitHub' }))

    expect(await screen.findByText(/Couldn't fetch that file/)).toBeInTheDocument()
  })

  it('Push to GitHub offers Create for a file that does not exist yet', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve({ status: url.includes('/contents/') ? 404 : 200 } as Response),
      ),
    )

    render(<ConfigWorkspace definition={tenantConfigDefinition} />)
    fillTargetFile()
    fireEvent.change(screen.getByPlaceholderText('product name'), { target: { value: 'checkout' } })
    fireEvent.change(screen.getByPlaceholderText('*.github.com'), { target: { value: '*.github.com' } })
    fireEvent.change(screen.getByPlaceholderText('name'), { target: { value: 'billing' } })
    fireEvent.change(screen.getByPlaceholderText('description'), { target: { value: 'Billing service' } })

    fireEvent.click(screen.getByRole('button', { name: 'Push to GitHub' }))

    expect(await screen.findByRole('link', { name: 'Create file on GitHub' })).toBeInTheDocument()
  })

  it('Push to GitHub offers Update for a file that already exists', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ status: 200 } as Response)))

    render(<ConfigWorkspace definition={tenantConfigDefinition} />)
    fillTargetFile()
    fireEvent.change(screen.getByPlaceholderText('product name'), { target: { value: 'checkout' } })
    fireEvent.change(screen.getByPlaceholderText('*.github.com'), { target: { value: '*.github.com' } })
    fireEvent.change(screen.getByPlaceholderText('name'), { target: { value: 'billing' } })
    fireEvent.change(screen.getByPlaceholderText('description'), { target: { value: 'Billing service' } })

    fireEvent.click(screen.getByRole('button', { name: 'Push to GitHub' }))

    expect(await screen.findByRole('link', { name: 'Open file on GitHub to update' })).toBeInTheDocument()
  })
})
