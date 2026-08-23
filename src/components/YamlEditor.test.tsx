import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import YamlEditor from './YamlEditor'

// CodeMirror renders a contenteditable DOM (not a native <input>/<textarea>), so realistic
// keystroke-driven typing isn't reliably simulated under jsdom - that's exercised by
// CodeMirror's own test suite, not ours. These tests cover what our wrapper is actually
// responsible for: mounting, the controlled-value sync effect, and forwarding focus/blur.
// ConfigWorkspace.test.tsx mocks this component with a plain textarea to test the app's own
// bidirectional sync logic without depending on CodeMirror's DOM internals.
describe('YamlEditor', () => {
  it('mounts under jsdom and renders the initial value', () => {
    const { container } = render(<YamlEditor value="tenant: acme" onChange={vi.fn()} />)
    expect(container.querySelector('.cm-content')?.textContent).toContain('tenant: acme')
  })

  it('updates the displayed document when the value prop changes', () => {
    const { container, rerender } = render(<YamlEditor value="tenant: acme" onChange={vi.fn()} />)
    rerender(<YamlEditor value="tenant: other" onChange={vi.fn()} />)
    expect(container.querySelector('.cm-content')?.textContent).toContain('tenant: other')
  })

  it('does not touch the document when the value prop is unchanged, avoiding cursor disruption', () => {
    const { container, rerender } = render(<YamlEditor value="tenant: acme" onChange={vi.fn()} />)
    const before = container.querySelector('.cm-content')?.textContent
    rerender(<YamlEditor value="tenant: acme" onChange={vi.fn()} />)
    expect(container.querySelector('.cm-content')?.textContent).toBe(before)
  })

  it('forwards focus and blur DOM events', () => {
    const onFocus = vi.fn()
    const onBlur = vi.fn()
    const { container } = render(<YamlEditor value="x: 1" onChange={vi.fn()} onFocus={onFocus} onBlur={onBlur} />)
    const content = container.querySelector('.cm-content') as HTMLElement
    content.dispatchEvent(new FocusEvent('focus'))
    expect(onFocus).toHaveBeenCalledTimes(1)
    content.dispatchEvent(new FocusEvent('blur'))
    expect(onBlur).toHaveBeenCalledTimes(1)
  })

  it('tears down the editor view on unmount without throwing', () => {
    const { unmount } = render(<YamlEditor value="x: 1" onChange={vi.fn()} />)
    expect(() => unmount()).not.toThrow()
  })
})
