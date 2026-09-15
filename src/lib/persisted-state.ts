import { useEffect, useState } from 'react'

const PREFIX = 'yaml-config-generator:'

function resolveInitial<T>(initial: T | (() => T)): T {
  return typeof initial === 'function' ? (initial as () => T)() : initial
}

function readStored<T>(key: string, initial: T | (() => T)): T {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : resolveInitial(initial)
  } catch {
    return resolveInitial(initial)
  }
}

// Persists state to localStorage under a namespaced key, so it survives page reloads and
// (via a stable per-config-type key) switching between config types without losing drafts.
// Purely client-side - works the same on any static host, GitHub Pages included.
export function usePersistedState<T>(key: string, initial: T | (() => T)) {
  const [value, setValue] = useState<T>(() => readStored(key, initial))

  useEffect(() => {
    writePersistedState(key, value)
  }, [key, value])

  return [value, setValue] as const
}

export function readPersistedState<T>(key: string, initial: T | (() => T)): T {
  return readStored(key, initial)
}

// Writes a key without mounting a hook for it, for the one case that needs it: seeding another
// config type's draft while that type's form isn't on screen (see src/onboarding/seed.ts).
// Returns false if storage is unavailable (quota, private browsing) so a caller can avoid
// reporting a write that didn't actually happen - the form still works in-memory either way.
export function writePersistedState<T>(key: string, value: T): boolean {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}
