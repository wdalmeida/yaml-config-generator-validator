import { CONFIG_DEFINITIONS, getDraftStatus, type ConfigDefinition, type DraftStatus } from './configs'
import { getOnboardingStatus, ONBOARDING_DEFINITIONS, type OnboardingDefinition } from './onboarding'

// The only module that knows both kinds of pill exist. Wrapping the two registries here - rather
// than adding a `kind` field to ConfigDefinition, or widening it with optional schema?/fields? -
// keeps ConfigWorkspace's prop non-optional and leaves exactly two narrowings in the codebase
// (navStatus below, and the JSX branch in App), both on a union TypeScript exhaustively checks.
export type NavEntry =
  | { kind: 'config'; id: string; label: string; definition: ConfigDefinition }
  | { kind: 'onboarding'; id: string; label: string; definition: OnboardingDefinition }

// Onboarding first: it's the front door for someone who doesn't yet know which files they need.
// `selected-config-id` is persisted, so this only changes the default pill for a fresh browser.
export const NAV_ENTRIES: NavEntry[] = [
  ...ONBOARDING_DEFINITIONS.map(
    (definition): NavEntry => ({ kind: 'onboarding', id: definition.id, label: definition.label, definition }),
  ),
  ...CONFIG_DEFINITIONS.map((definition): NavEntry => ({ kind: 'config', id: definition.id, label: definition.label, definition })),
]

// Unlike getConfigDefinition, this never throws. `selected-config-id` lives in the user's
// browser and can outlive the entry it names - a schema file renamed or deleted, or a build
// shipped without a checklist. Falling back to the first pill turns what is currently an
// unrecoverable blank page into "you're on the first tab".
export function getNavEntry(id: string): NavEntry {
  return NAV_ENTRIES.find((entry) => entry.id === id) ?? NAV_ENTRIES[0]
}

export function navStatus(entry: NavEntry): DraftStatus {
  return entry.kind === 'config' ? getDraftStatus(entry.definition) : getOnboardingStatus(entry.definition)
}
