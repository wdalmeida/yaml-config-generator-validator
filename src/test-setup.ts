import { vi } from 'vitest'
import '@testing-library/jest-dom/vitest'

// jsdom doesn't implement the Clipboard API; components that call navigator.clipboard.writeText
// (e.g. "Copy YAML") would otherwise throw in tests.
Object.assign(navigator, { clipboard: { writeText: vi.fn() } })
