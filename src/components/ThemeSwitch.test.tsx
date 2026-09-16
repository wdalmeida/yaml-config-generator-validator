import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ThemeSwitch } from './ThemeSwitch'
import { readTheme } from '../lib/theme'

describe('ThemeSwitch', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  // A radiogroup, not three toggle buttons: exactly one of three is active. The legend is
  // visually hidden because the three labels already say what the group is on screen, but a
  // screen reader announces it before each option.
  it('is a radiogroup of three, opening on Auto', () => {
    render(<ThemeSwitch />)
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(screen.getByRole('radio', { name: 'Auto' })).toBeChecked()
    expect(screen.getByRole('group', { name: 'Colour theme' })).toBeInTheDocument()
  })

  it('applies and persists a choice', () => {
    render(<ThemeSwitch />)
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }))
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(readTheme()).toBe('dark')
  })

  it('goes back to following the OS when Auto is chosen again', () => {
    render(<ThemeSwitch />)
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }))
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    fireEvent.click(screen.getByRole('radio', { name: 'Auto' }))
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('restores the stored choice on mount, before anything is clicked', () => {
    localStorage.setItem('yaml-config-generator:theme', JSON.stringify('dark'))
    render(<ThemeSwitch />)
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked()
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })
})
