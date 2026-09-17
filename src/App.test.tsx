import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from './App'
import { NAV_ENTRIES } from './nav'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
})

// Pills are queried through the nav, not the whole document: an onboarding step can carry a
// "config" action rendering an "Open CI →" button, which a bare /CI/ role query also matches.
function pill(label: string) {
  return within(screen.getByRole('navigation')).getByRole('button', { name: new RegExp(label) })
}

describe('App', () => {
  it('renders one pill per nav entry, opening on the first by default', () => {
    render(<App />)
    for (const entry of NAV_ENTRIES) {
      expect(pill(entry.label)).toBeInTheDocument()
    }
    expect(pill(NAV_ENTRIES[0].label)).toHaveClass('active')
  })

  it('opens on the onboarding checklist, which leads the strip', () => {
    render(<App />)
    expect(NAV_ENTRIES[0].kind).toBe('onboarding')
    expect(screen.getByText('Raise the onboarding request ticket')).toBeInTheDocument()
  })

  it('switching pills swaps the workspace to that config type’s own fields', () => {
    render(<App />)
    const ci = NAV_ENTRIES.find((e) => e.id === 'ci')!

    fireEvent.click(pill(ci.label))

    expect(pill(ci.label)).toHaveClass('active')
    // A field unique to the CI schema, not present on the checklist shown by default.
    expect(screen.getByText('Runtime')).toBeInTheDocument()
  })

  it('remembers the selected pill across a remount (persisted via localStorage)', () => {
    const { unmount } = render(<App />)
    const protection = NAV_ENTRIES.find((e) => e.id === 'protection')!
    fireEvent.click(pill(protection.label))
    unmount()

    render(<App />)
    expect(pill(protection.label)).toHaveClass('active')
  })

  it('falls back to the first pill when the persisted id names an entry that no longer exists', () => {
    // Stored as JSON - without the inner quotes readStored's JSON.parse throws into its own
    // catch and returns the initial value, so the test would pass for the wrong reason.
    localStorage.setItem('yaml-config-generator:selected-config-id', '"deleted-config-type"')

    expect(() => render(<App />)).not.toThrow()
    expect(pill(NAV_ENTRIES[0].label)).toHaveClass('active')
  })

  it('a step’s config action switches to that config type’s pill', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /Open Tenant Config/ }))

    expect(pill('Tenant Config')).toHaveClass('active')
  })

  it('seeding from the checklist prefills the tenant config draft', () => {
    render(<App />)

    fireEvent.change(screen.getByLabelText('Product'), { target: { value: 'widgets' } })
    fireEvent.click(screen.getByRole('button', { name: 'Seed config drafts' }))
    expect(screen.getByText(/Seeded Product into Tenant Config/)).toBeInTheDocument()

    fireEvent.click(pill('Tenant Config'))
    expect(screen.getByPlaceholderText('product name')).toHaveValue('widgets')
  })

  it('seeding reaches the Kubernetes pill, which names every resource from those two values', async () => {
    render(<App />)

    fireEvent.change(screen.getByLabelText('Tenant'), { target: { value: 'globex' } })
    fireEvent.change(screen.getByLabelText('Product'), { target: { value: 'gadgets' } })
    fireEvent.click(screen.getByRole('button', { name: 'Seed config drafts' }))

    fireEvent.click(pill('Kubernetes'))
    // The real (unmocked) lazy YamlEditor renders here, so wait for it before reading. Assert on
    // the manifest stream specifically rather than on "somewhere on the page": the derived
    // namespace is also shown in the form's own hints, so a page-wide text query now matches
    // several elements and would pass without the manifests being named at all.
    // ...and wait on the panel rather than on a query, since the lazy editor may still be the
    // Suspense textarea when the hints have already rendered.
    await waitFor(() =>
      expect(document.querySelector('.yaml-panel')?.textContent ?? '').toContain('name: globex-gadgets'),
    )
  })

  it('a step’s Kubernetes action switches to that pill', () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /Open Kubernetes/ }))

    expect(pill('Kubernetes')).toHaveClass('active')
  })
})
