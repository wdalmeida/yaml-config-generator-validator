import { useEffect } from 'react'
import { usePersistedState } from '../lib/persisted-state'
import { applyTheme, THEME_CHOICES, THEME_KEY, themeLabel, type ThemeChoice } from '../lib/theme'

// A radiogroup, like the onboarding CLI/UI switch and for the same reason: exactly one of three
// is active, which is what a radiogroup *is*. Three aria-pressed buttons would re-implement the
// keyboard and screen-reader behaviour the native inputs already have, slightly worse.
//
// Deliberately not a two-state toggle. "Auto" is not a fiddly extra - it is the only setting
// that keeps following the OS when it switches at sunset, and it is the default, so a reader
// who never touches this gets the behaviour the app had before the switch existed.
export function ThemeSwitch() {
  const [theme, setTheme] = usePersistedState<ThemeChoice>(THEME_KEY, 'auto')

  // main.tsx already applied the stored choice before the first paint; this keeps the attribute
  // in step with later changes, and re-asserts it if something else cleared it.
  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  return (
    <fieldset className="theme-switch">
      <legend className="visually-hidden">Colour theme</legend>
      {THEME_CHOICES.map((choice) => (
        <label key={choice} className={theme === choice ? 'active' : undefined}>
          <input
            type="radio"
            name="theme"
            value={choice}
            checked={theme === choice}
            onChange={() => setTheme(choice)}
          />
          {themeLabel(choice)}
        </label>
      ))}
    </fieldset>
  )
}
