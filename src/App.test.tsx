import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import App from './App'
import { CONFIG_DEFINITIONS } from './configs'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
})

describe('App', () => {
  it('renders one pill per config type, opening on the first by default', () => {
    render(<App />)
    for (const def of CONFIG_DEFINITIONS) {
      expect(screen.getByRole('button', { name: new RegExp(def.label) })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: new RegExp(CONFIG_DEFINITIONS[0].label) })).toHaveClass('active')
  })

  it('switching pills swaps the workspace to that config type’s own fields', () => {
    render(<App />)
    const ci = CONFIG_DEFINITIONS.find((d) => d.id === 'ci')!

    fireEvent.click(screen.getByRole('button', { name: new RegExp(ci.label) }))

    expect(screen.getByRole('button', { name: new RegExp(ci.label) })).toHaveClass('active')
    // A field unique to the CI schema, not present on the config type shown by default.
    expect(screen.getByText('Runtime')).toBeInTheDocument()
  })

  it('remembers the selected pill across a remount (persisted via localStorage)', () => {
    const { unmount } = render(<App />)
    const protection = CONFIG_DEFINITIONS.find((d) => d.id === 'protection')!
    fireEvent.click(screen.getByRole('button', { name: new RegExp(protection.label) }))
    unmount()

    render(<App />)
    expect(screen.getByRole('button', { name: new RegExp(protection.label) })).toHaveClass('active')
  })
})
