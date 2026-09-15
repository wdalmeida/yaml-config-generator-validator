import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { OnboardingWorkspace } from './OnboardingWorkspace'
import { ONBOARDING_DEFINITIONS } from '../onboarding'

// CodeMirror's real DOM (contenteditable) isn't reliably driven by fireEvent.change under
// jsdom, so as in ConfigWorkspace.test.tsx we replace it with a plain textarea sharing the
// exact same props contract. These tests exercise this component's own sync logic, not
// CodeMirror's internals - YamlEditor.test.tsx covers the real wrapper.
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
    onFocus: () => void
    onBlur: () => void
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

const definition = ONBOARDING_DEFINITIONS[0]
const firstStep = definition.steps[0]

function renderWorkspace(overrides: Partial<Parameters<typeof OnboardingWorkspace>[0]> = {}) {
  const onOpenConfig = vi.fn()
  const onSeeded = vi.fn()
  render(<OnboardingWorkspace definition={definition} onOpenConfig={onOpenConfig} onSeeded={onSeeded} {...overrides} />)
  return { onOpenConfig, onSeeded }
}

// React.lazy means the field isn't there on first paint.
function yamlField() {
  return screen.findByTestId('yaml-field') as Promise<HTMLTextAreaElement>
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

function fillTargetFile() {
  fireEvent.change(screen.getByPlaceholderText('owner'), { target: { value: 'acme' } })
  fireEvent.change(screen.getByPlaceholderText('repo'), { target: { value: 'widget-service' } })
}

describe('OnboardingWorkspace', () => {
  it('renders one list item per step, with its title', () => {
    renderWorkspace()

    expect(screen.getAllByRole('listitem')).toHaveLength(definition.steps.length)
    expect(screen.getByText(firstStep.title)).toBeInTheDocument()
  })

  it('ticking a step checks it, marks the row done, and shows in the progress count', () => {
    renderWorkspace()
    const checkbox = screen.getByRole('checkbox', { name: new RegExp(firstStep.title) })

    fireEvent.click(checkbox)

    expect(checkbox).toBeChecked()
    expect(screen.getByText(firstStep.title).closest('li')).toHaveClass('done')
    expect(screen.getByText(`1 of ${definition.steps.length} done`)).toBeInTheDocument()
  })

  it('ticking a step appears in the YAML field', async () => {
    renderWorkspace()
    const field = await yamlField()

    fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(firstStep.title) }))

    await waitFor(() => expect(field.value).toContain(firstStep.id))
  })

  it('typing details syncs them into the YAML field', async () => {
    renderWorkspace()
    const field = await yamlField()

    fireEvent.change(screen.getByLabelText('Tenant'), { target: { value: 'acme' } })
    fireEvent.change(screen.getByLabelText('Product'), { target: { value: 'widgets' } })

    await waitFor(() => expect(field.value).toContain('tenant: acme'))
    expect(field.value).toContain('product: widgets')
  })

  it('pasting valid YAML restores the ticks and the details', async () => {
    renderWorkspace()
    const field = await yamlField()

    fireEvent.change(field, {
      target: { value: `tenant: globex\nproduct: gadgets\ncompleted:\n  - ${firstStep.id}\n` },
    })

    expect(screen.getByRole('checkbox', { name: new RegExp(firstStep.title) })).toBeChecked()
    expect(screen.getByLabelText('Tenant')).toHaveValue('globex')
    expect(screen.getByLabelText('Product')).toHaveValue('gadgets')
  })

  it('an unrecognised step id in pasted YAML survives instead of being dropped', async () => {
    renderWorkspace()
    const field = await yamlField()

    fireEvent.change(field, { target: { value: `completed:\n  - renamed-away\n  - ${firstStep.id}\n` } })
    fireEvent.blur(field)
    // Nudge the state so the form -> text effect re-emits from state rather than echoing the
    // text the user just typed.
    fireEvent.change(screen.getByLabelText('Tenant'), { target: { value: 'acme' } })

    // Re-emitted from state, so the unknown id round-tripped rather than being discarded.
    await waitFor(() => expect(field.value).toContain('renamed-away'))
    expect(field.value).toContain(firstStep.id)
  })

  it('malformed YAML shows an error and leaves the checklist untouched', async () => {
    renderWorkspace()
    fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(firstStep.title) }))
    const field = await yamlField()

    fireEvent.change(field, { target: { value: 'completed: 3\n' } })

    expect(screen.getByText(/expected array, received number/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: new RegExp(firstStep.title) })).toBeChecked()
  })

  it('does not clobber the field while the user is typing in it', async () => {
    renderWorkspace()
    const field = await yamlField()

    fireEvent.focus(field)
    fireEvent.change(field, { target: { value: 'tenant: typed-here\n' } })

    expect(field).toHaveValue('tenant: typed-here\n')
  })

  describe('step actions', () => {
    it('renders a docs link', () => {
      renderWorkspace()
      const link = screen.getAllByRole('link', { name: /Docs/ })[0]
      expect(link).toHaveAttribute('href', expect.stringMatching(/^https:\/\//))
      expect(link).toHaveAttribute('target', '_blank')
    })

    it('shows a Jira key as plain text while the base URL is unset', () => {
      renderWorkspace()

      expect(screen.queryByRole('link', { name: /Jira PLAT-1001/ })).not.toBeInTheDocument()
      expect(screen.getByText(/Jira PLAT-1001/)).toBeInTheDocument()
    })

    it('turns Jira keys into links once a base URL is typed', () => {
      renderWorkspace()

      fireEvent.change(screen.getByLabelText('Jira base URL'), { target: { value: 'https://acme.atlassian.net' } })

      expect(screen.getByRole('link', { name: /Jira PLAT-1001/ })).toHaveAttribute(
        'href',
        'https://acme.atlassian.net/browse/PLAT-1001',
      )
    })

    it('renders no Jira link for a javascript: base URL', () => {
      renderWorkspace()

      fireEvent.change(screen.getByLabelText('Jira base URL'), { target: { value: 'javascript:alert(1)' } })

      expect(screen.queryByRole('link', { name: /Jira PLAT-1001/ })).not.toBeInTheDocument()
    })

    it('copies a command action to the clipboard', () => {
      renderWorkspace()

      fireEvent.click(screen.getByRole('button', { name: /Copy install the toolchain/i }))

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('just install')
    })

    it('a config action asks App to switch pills', () => {
      const { onOpenConfig } = renderWorkspace()

      fireEvent.click(screen.getByRole('button', { name: /Open Tenant Config/ }))

      expect(onOpenConfig).toHaveBeenCalledWith('tenant-config')
    })
  })

  describe('fetch from GitHub', () => {
    it('loads a saved checklist into the field and back into the checkboxes', async () => {
      const saved = `tenant: globex\nproduct: gadgets\ncompleted:\n  - ${firstStep.id}\n`
      const content = btoa(String.fromCharCode(...new TextEncoder().encode(saved)))
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve({ status: 200, json: () => Promise.resolve({ content, encoding: 'base64' }) } as Response)),
      )

      renderWorkspace()
      const field = await yamlField()
      fillTargetFile()
      fireEvent.click(screen.getByRole('button', { name: 'Fetch from GitHub' }))

      await waitFor(() => expect(field.value).toContain('tenant: globex'))
      expect(screen.getByRole('checkbox', { name: new RegExp(firstStep.title) })).toBeChecked()
    })

    it('shows an error when the file cannot be fetched', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ status: 404 } as Response)))

      renderWorkspace()
      await yamlField()
      fillTargetFile()
      fireEvent.click(screen.getByRole('button', { name: 'Fetch from GitHub' }))

      await waitFor(() => expect(screen.getByText(/Couldn't fetch that file/)).toBeInTheDocument())
    })
  })

  describe('seeding', () => {
    it('is disabled until a tenant or product is typed', () => {
      renderWorkspace()
      expect(screen.getByRole('button', { name: 'Seed config drafts' })).toBeDisabled()

      fireEvent.change(screen.getByLabelText('Product'), { target: { value: 'widgets' } })
      expect(screen.getByRole('button', { name: 'Seed config drafts' })).toBeEnabled()
    })

    it('writes the tenant config draft and reports what it did', () => {
      const { onSeeded } = renderWorkspace()

      fireEvent.change(screen.getByLabelText('Tenant'), { target: { value: 'globex' } })
      fireEvent.change(screen.getByLabelText('Product'), { target: { value: 'widgets' } })
      fireEvent.click(screen.getByRole('button', { name: 'Seed config drafts' }))

      expect(screen.getByText('Seeded Tenant, Product into Tenant Config.')).toBeInTheDocument()
      expect(JSON.parse(localStorage.getItem('yaml-config-generator:draft:tenant-config')!)).toMatchObject({
        tenant: 'globex',
        product: 'widgets',
      })
      expect(onSeeded).toHaveBeenCalled()
    })

    it('caps the tenant at the length tenant-config accepts', () => {
      renderWorkspace()
      expect(screen.getByLabelText('Tenant')).toHaveAttribute('maxlength', '12')
    })
  })
})
