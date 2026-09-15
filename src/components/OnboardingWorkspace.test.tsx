import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { OnboardingWorkspace } from './OnboardingWorkspace'
import { ONBOARDING_DEFINITIONS } from '../onboarding'

const definition = ONBOARDING_DEFINITIONS[0]
const firstStep = definition.steps[0]

function renderWorkspace(overrides: Partial<Parameters<typeof OnboardingWorkspace>[0]> = {}) {
  const onOpenConfig = vi.fn()
  const onSeeded = vi.fn()
  const { unmount } = render(
    <OnboardingWorkspace definition={definition} onOpenConfig={onOpenConfig} onSeeded={onSeeded} {...overrides} />,
  )
  return { onOpenConfig, onSeeded, unmount }
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

describe('OnboardingWorkspace', () => {
  it('renders one list item per step, with its title', () => {
    renderWorkspace()

    expect(screen.getAllByRole('listitem')).toHaveLength(definition.steps.length)
    expect(screen.getByText(firstStep.title)).toBeInTheDocument()
  })

  // The steps are the page: there's no file to generate here, so nothing competes with them.
  it('has no YAML field and no GitHub target of its own', () => {
    renderWorkspace()

    expect(screen.queryByRole('textbox', { name: /yaml/i })).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('owner')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('repo')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Push to GitHub/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Fetch from GitHub/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Copy YAML/ })).not.toBeInTheDocument()
  })

  it('ticking a step checks it, marks the row done, and shows in the progress count', () => {
    renderWorkspace()
    const checkbox = screen.getByRole('checkbox', { name: new RegExp(firstStep.title) })

    fireEvent.click(checkbox)

    expect(checkbox).toBeChecked()
    expect(screen.getByText(firstStep.title).closest('li')).toHaveClass('done')
    expect(screen.getByText(`1 of ${definition.steps.length} done`)).toBeInTheDocument()
  })

  it('unticking a step clears it again', () => {
    renderWorkspace()
    const checkbox = screen.getByRole('checkbox', { name: new RegExp(firstStep.title) })

    fireEvent.click(checkbox)
    fireEvent.click(checkbox)

    expect(checkbox).not.toBeChecked()
    expect(screen.getByText(`0 of ${definition.steps.length} done`)).toBeInTheDocument()
  })

  it('persists progress across a remount', () => {
    const { unmount } = renderWorkspace()
    fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(firstStep.title) }))
    unmount()

    renderWorkspace()
    expect(screen.getByRole('checkbox', { name: new RegExp(firstStep.title) })).toBeChecked()
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

    it('links to the Kubernetes pill, which is not one of the config file types', () => {
      const { onOpenConfig } = renderWorkspace()

      fireEvent.click(screen.getByRole('button', { name: /Open Kubernetes/ }))

      expect(onOpenConfig).toHaveBeenCalledWith('kubernetes')
    })
  })

  describe('seeding', () => {
    it('is disabled until a tenant or product is typed', () => {
      renderWorkspace()
      expect(screen.getByRole('button', { name: 'Seed config drafts' })).toBeDisabled()

      fireEvent.change(screen.getByLabelText('Product'), { target: { value: 'widgets' } })
      expect(screen.getByRole('button', { name: 'Seed config drafts' })).toBeEnabled()
    })

    it('writes the tenant config and kubernetes drafts, and reports what it did', () => {
      const { onSeeded } = renderWorkspace()

      fireEvent.change(screen.getByLabelText('Tenant'), { target: { value: 'globex' } })
      fireEvent.change(screen.getByLabelText('Product'), { target: { value: 'widgets' } })
      fireEvent.click(screen.getByRole('button', { name: 'Seed config drafts' }))

      expect(screen.getByText('Seeded Tenant, Product into Tenant Config.')).toBeInTheDocument()
      expect(screen.getByText('Seeded Tenant, Product into Kubernetes.')).toBeInTheDocument()
      expect(JSON.parse(localStorage.getItem('yaml-config-generator:draft:kubernetes')!)).toMatchObject({
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
