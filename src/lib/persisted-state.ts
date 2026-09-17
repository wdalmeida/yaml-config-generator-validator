import { useEffect, useState } from 'react'

const PREFIX = 'yaml-config-generator:'

function resolveInitial<T>(initial: T | (() => T)): T {
  return typeof initial === 'function' ? (initial as () => T)() : initial
}

function readFrom<T>(store: () => Storage, key: string, initial: T | (() => T)): T {
  try {
    const raw = store().getItem(PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : resolveInitial(initial)
  } catch {
    return resolveInitial(initial)
  }
}

function writeTo<T>(store: () => Storage, key: string, value: T): boolean {
  try {
    store().setItem(PREFIX + key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

function readStored<T>(key: string, initial: T | (() => T)): T {
  return readFrom(() => localStorage, key, initial)
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
  return writeTo(() => localStorage, key, value)
}

// sessionStorage, not localStorage - a deliberately weaker promise, for values that should not
// outlive the tab. It is scoped to one tab (a second tab gets its own empty copy) and the browser
// drops it when that tab closes, so a secret typed here survives a reload - which is the whole
// point, since losing it on every refresh would push people to paste it somewhere worse - without
// being left on the machine afterwards. It is not encryption and not isolation: while the tab is
// open, any script on the origin can still read it. See src/kubernetes/index.ts.
export function useSessionState<T>(key: string, initial: T | (() => T)) {
  const [value, setValue] = useState<T>(() => readFrom(() => sessionStorage, key, initial))

  useEffect(() => {
    writeSessionState(key, value)
  }, [key, value])

  return [value, setValue] as const
}

export function readSessionState<T>(key: string, initial: T | (() => T)): T {
  return readFrom(() => sessionStorage, key, initial)
}

export function writeSessionState<T>(key: string, value: T): boolean {
  return writeTo(() => sessionStorage, key, value)
}

// Removes the key outright rather than writing an empty value over it, so nothing is left behind
// for someone to find - an emptied JSON blob under a name like `secret:kubernetes` still tells a
// reader what used to be there.
export function clearSessionState(key: string): boolean {
  try {
    sessionStorage.removeItem(PREFIX + key)
    return true
  } catch {
    return false
  }
}
