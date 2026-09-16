import { readPersistedState } from './persisted-state'

/**
 * Three states, not a boolean. "auto" is the absence of a choice - no attribute, so App.css's
 * `prefers-color-scheme` query decides and the page follows the OS as it changes, including
 * mid-session. The other two are a deliberate override that has to beat the OS in either
 * direction, which is why App.css states the dark palette twice.
 */
export type ThemeChoice = 'auto' | 'light' | 'dark'

export const THEME_KEY = 'theme'
export const THEME_CHOICES: ThemeChoice[] = ['auto', 'light', 'dark']

const LABELS: Record<ThemeChoice, string> = {
  auto: 'Auto',
  light: 'Light',
  dark: 'Dark',
}

export function themeLabel(choice: ThemeChoice): string {
  return LABELS[choice]
}

function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === 'auto' || value === 'light' || value === 'dark'
}

/**
 * Reads the stored choice without mounting anything, for the pre-render call in main.tsx.
 * Anything unrecognised falls back to "auto" rather than throwing - this value lives in the
 * reader's browser and can outlive whatever wrote it, the same reasoning as getNavEntry's
 * fallback for a stale pill id.
 */
export function readTheme(): ThemeChoice {
  const stored = readPersistedState<unknown>(THEME_KEY, 'auto')
  return isThemeChoice(stored) ? stored : 'auto'
}

/**
 * Sets (or clears) `data-theme` on <html>. Clearing rather than writing "auto" is the point:
 * the CSS keys off the attribute's absence, so auto is not a third palette to maintain, it is
 * the media query doing its job.
 *
 * Called from main.tsx before the first render, not only from an effect. An effect runs after
 * paint, so a reader who chose a theme opposite to their OS would see one frame of the wrong
 * one on every page load. The usual fix is an inline <script> in index.html, which this app
 * cannot use: container/nginx.conf's CSP is `default-src 'self'` with no `unsafe-inline` for
 * scripts, so the browser would refuse to run it.
 */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement
  if (choice === 'auto') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', choice)
}
