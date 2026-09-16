import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
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

    // Scoped to the checklist: a step's instructions are an <ol> of their own, so a bare
    // listitem query counts those too.
    const checklist = document.querySelector('ol.checklist')!
    expect(within(checklist as HTMLElement).getAllByRole('listitem').filter((li) => li.classList.contains('checklist-step')))
      .toHaveLength(definition.steps.length)
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

  describe('the CLI / UI switch', () => {
    const cliOnlyStep = definition.steps.find((s) => s.cli && !s.ui)!
    const uiOnlyStep = definition.steps.find((s) => s.ui && !s.cli)!
    const bothStep = definition.steps.find((s) => s.cli && s.ui)!

    it('opens on the command line route', () => {
      renderWorkspace()
      expect(screen.getByRole('radio', { name: 'Command line' })).toBeChecked()
    })

    // Generic on purpose: a step's UI route is often some interface other than the console
    // (a Jira form, an access portal), so naming the console here would be wrong.
    it('labels the routes generically, not after any one console', () => {
      renderWorkspace()
      expect(screen.getByRole('radio', { name: 'UI' })).toBeInTheDocument()
      expect(screen.queryByRole('radio', { name: 'OpenShift console' })).not.toBeInTheDocument()
    })

    it('shows only the selected route when the step documents both', () => {
      renderWorkspace()
      expect(screen.getByText(bothStep.cli!.instructions[0])).toBeInTheDocument()
      expect(screen.queryByText(bothStep.ui!.instructions[0])).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('radio', { name: 'UI' }))

      expect(screen.getByText(bothStep.ui!.instructions[0])).toBeInTheDocument()
      expect(screen.queryByText(bothStep.cli!.instructions[0])).not.toBeInTheDocument()
    })

    it('hides a command from a reader who asked for the UI route', () => {
      // A step that documents *both*, so there is a genuine choice to honour - unlike the
      // CLI-only step below, whose command stays put precisely because there is no alternative.
      const command = bothStep.cli!.actions.find((a) => a.type === 'command')!
      const label = new RegExp(`Copy${command.label ? ` ${command.label}` : ''}`, 'i')

      renderWorkspace()
      const row = () => screen.getByText(bothStep.title).closest('li')!
      expect(within(row()).getByRole('button', { name: label })).toBeInTheDocument()

      fireEvent.click(screen.getByRole('radio', { name: 'UI' }))

      expect(within(row()).queryByRole('button', { name: label })).not.toBeInTheDocument()
    })

    it('still shows a step’s only route when there is no choice to make', () => {
      renderWorkspace()
      fireEvent.click(screen.getByRole('radio', { name: 'UI' }))

      // cliOnlyStep has no UI route, so its commands stay visible rather than vanishing.
      const row = screen.getByText(cliOnlyStep.title).closest('li')!
      expect(within(row).getByText(cliOnlyStep.cli!.instructions[0])).toBeInTheDocument()
      expect(within(row).getByText('CLI only')).toBeInTheDocument()
    })

    it('does the same in the other direction', () => {
      renderWorkspace()

      const row = screen.getByText(uiOnlyStep.title).closest('li')!
      expect(within(row).getByText(uiOnlyStep.ui!.instructions[0])).toBeInTheDocument()
      expect(within(row).getByText('UI only')).toBeInTheDocument()
    })

    it('does not tag a step that documents both routes', () => {
      renderWorkspace()
      const row = screen.getByText(bothStep.title).closest('li')!
      expect(within(row).queryByText(/only$/)).not.toBeInTheDocument()
    })

    it('remembers the choice across a remount', () => {
      const { unmount } = renderWorkspace()
      fireEvent.click(screen.getByRole('radio', { name: 'UI' }))
      unmount()

      renderWorkspace()
      expect(screen.getByRole('radio', { name: 'UI' })).toBeChecked()
    })
  })

  describe('the console link', () => {
    const consoleStep = definition.steps.find((s) => s.ui?.console)!

    function switchToUi() {
      fireEvent.click(screen.getByRole('radio', { name: 'UI' }))
    }

    it('shows the path as plain text while no base URL is set', () => {
      renderWorkspace()
      switchToUi()

      const row = screen.getByText(consoleStep.title).closest('li')!
      expect(within(row).queryByRole('link', { name: /Open in OpenShift console/ })).not.toBeInTheDocument()
      expect(within(row).getByText(consoleStep.ui!.console!)).toBeInTheDocument()
    })

    it('becomes a real link once a base URL is typed', () => {
      renderWorkspace()
      switchToUi()

      fireEvent.change(screen.getByLabelText('OpenShift console base URL'), {
        target: { value: 'https://console.apps.acme.com/' },
      })

      const row = screen.getByText(consoleStep.title).closest('li')!
      expect(within(row).getByRole('link', { name: /Open in OpenShift console/ })).toHaveAttribute(
        'href',
        `https://console.apps.acme.com${consoleStep.ui!.console}`,
      )
    })

    it('renders no link for a javascript: base URL', () => {
      renderWorkspace()
      switchToUi()

      fireEvent.change(screen.getByLabelText('OpenShift console base URL'), { target: { value: 'javascript:alert(1)' } })

      expect(screen.queryByRole('link', { name: /Open in OpenShift console/ })).not.toBeInTheDocument()
    })

    it('explains that links open in a new tab, since a page cannot split the browser itself', () => {
      renderWorkspace()
      expect(screen.queryByText(/open in a new tab/)).not.toBeInTheDocument()

      switchToUi()
      expect(screen.getByText(/Links open in a new tab/)).toBeInTheDocument()
    })

    it('still names the specific console on the link itself', () => {
      renderWorkspace()
      switchToUi()
      fireEvent.change(screen.getByLabelText('OpenShift console base URL'), {
        target: { value: 'https://console.apps.acme.com' },
      })

      expect(screen.getAllByRole('link', { name: /Open in OpenShift console/ }).length).toBeGreaterThan(0)
    })
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
