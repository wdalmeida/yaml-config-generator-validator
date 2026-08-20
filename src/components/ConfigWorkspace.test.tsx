import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ConfigWorkspace } from './ConfigWorkspace'
import { getConfigDefinition } from '../configs'

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

function fillTargetFile({ owner = 'acme-co', repo = 'infra', path = 'config.yaml' } = {}) {
  fireEvent.change(screen.getByPlaceholderText('owner'), { target: { value: owner } })
  fireEvent.change(screen.getByPlaceholderText('repo'), { target: { value: repo } })
  fireEvent.change(screen.getByPlaceholderText('path/to/file.yaml'), { target: { value: path } })
}

function outputYaml() {
  return (document.querySelector('.yaml-output') as HTMLTextAreaElement).value
}

function pasteBox() {
  return screen.getByPlaceholderText(`Paste the contents of ${tenantConfigDefinition.defaultFilename} here`)
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ConfigWorkspace', () => {
  it('fills in every field and reflects them in the Output YAML', () => {
    render(<ConfigWorkspace definition={tenantConfigDefinition} />)

    fireEvent.change(screen.getByPlaceholderText('product name'), { target: { value: 'checkout' } })
    fireEvent.change(screen.getByPlaceholderText('*.github.com'), { target: { value: '*.github.com' } })
    fireEvent.change(screen.getByPlaceholderText('name'), { target: { value: 'billing' } })
    fireEvent.change(screen.getByPlaceholderText('description'), { target: { value: 'Billing service' } })

    expect(outputYaml()).toBe(validYaml)
  })

  it('shows validation errors in Output when required fields are still blank', () => {
    render(<ConfigWorkspace definition={tenantConfigDefinition} />)

    const outputSection = screen.getByRole('heading', { name: 'Output' }).closest('section')!
    expect(within(outputSection).getByRole('list')).toBeInTheDocument()
    expect(outputYaml()).toBe('')
  })

  it('Validate reports a valid config without touching the form fields', () => {
    render(<ConfigWorkspace definition={tenantConfigDefinition} />)

    fireEvent.change(pasteBox(), { target: { value: validYaml } })
    fireEvent.click(screen.getByRole('button', { name: 'Validate' }))

    expect(screen.getByText('Valid config.')).toBeInTheDocument()
    // Untouched: the form's own product field is still blank.
    expect((screen.getByPlaceholderText('product name') as HTMLInputElement).value).toBe('')
  })

  it('Validate reports errors for invalid YAML', () => {
    render(<ConfigWorkspace definition={tenantConfigDefinition} />)

    fireEvent.change(pasteBox(), { target: { value: 'tenant: [unterminated' } })
    fireEvent.click(screen.getByRole('button', { name: 'Validate' }))

    expect(screen.getByText(/YAML syntax error/)).toBeInTheDocument()
  })

  it('Load into form populates the fields and clears the paste box', () => {
    render(<ConfigWorkspace definition={tenantConfigDefinition} />)

    fireEvent.change(pasteBox(), { target: { value: validYaml } })
    fireEvent.click(screen.getByRole('button', { name: 'Load into form' }))

    expect(screen.getByText('Loaded into the form.')).toBeInTheDocument()
    expect((screen.getByPlaceholderText('product name') as HTMLInputElement).value).toBe('checkout')
    expect((pasteBox() as HTMLTextAreaElement).value).toBe('')
  })

  it('Fetch from GitHub loads the file content into the paste box', async () => {
    const content = btoa(String.fromCharCode(...new TextEncoder().encode(validYaml)))
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ status: 200, json: () => Promise.resolve({ content, encoding: 'base64' }) } as Response)),
    )

    render(<ConfigWorkspace definition={tenantConfigDefinition} />)
    fillTargetFile()
    fireEvent.click(screen.getByRole('button', { name: 'Fetch from GitHub' }))

    await waitFor(() => expect(pasteBox()).toHaveValue(validYaml))
  })

  it('Fetch from GitHub shows an error when the file cannot be fetched', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ status: 404 } as Response)))

    render(<ConfigWorkspace definition={tenantConfigDefinition} />)
    fillTargetFile()
    fireEvent.click(screen.getByRole('button', { name: 'Fetch from GitHub' }))

    expect(await screen.findByText(/Couldn't fetch that file/)).toBeInTheDocument()
  })

  it('Get GitHub link offers Create for a file that does not exist yet', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'Get GitHub link' }))

    expect(await screen.findByRole('link', { name: 'Create file on GitHub' })).toBeInTheDocument()
  })

  it('Get GitHub link offers Update for a file that already exists', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ status: 200 } as Response)))

    render(<ConfigWorkspace definition={tenantConfigDefinition} />)
    fillTargetFile()
    fireEvent.change(screen.getByPlaceholderText('product name'), { target: { value: 'checkout' } })
    fireEvent.change(screen.getByPlaceholderText('*.github.com'), { target: { value: '*.github.com' } })
    fireEvent.change(screen.getByPlaceholderText('name'), { target: { value: 'billing' } })
    fireEvent.change(screen.getByPlaceholderText('description'), { target: { value: 'Billing service' } })

    fireEvent.click(screen.getByRole('button', { name: 'Get GitHub link' }))

    expect(await screen.findByRole('link', { name: 'Open file on GitHub to update' })).toBeInTheDocument()
  })
})
