import { CONFIG_DEFINITIONS, getDraftStatus, type ConfigDefinition, type DraftStatus } from './configs'
import { getKubernetesStatus, KUBERNETES_DEFINITION } from './kubernetes'
import { getOnboardingStatus, ONBOARDING_DEFINITIONS, type OnboardingDefinition } from './onboarding'

// The only module that knows every kind of pill exists. Wrapping the registries here - rather
// than adding a `kind` field to ConfigDefinition, or widening it with optional schema?/fields? -
// keeps ConfigWorkspace's prop non-optional. Narrowings live in navStatus and the JSX branch in
// App, both exhaustively checked by TypeScript.
export type NavEntry =
  | { kind: 'config'; id: string; label: string; definition: ConfigDefinition }
  | { kind: 'onboarding'; id: string; label: string; definition: OnboardingDefinition }
  | { kind: 'kubernetes'; id: string; label: string }

// Onboarding first: it's the front door for someone who doesn't yet know what they need.
// Kubernetes last: it's an output of the process, not one of the repo's config files.
// `selected-config-id` is persisted, so ordering only sets the default pill for a fresh browser.
export const NAV_ENTRIES: NavEntry[] = [
  ...ONBOARDING_DEFINITIONS.map(
    (definition): NavEntry => ({ kind: 'onboarding', id: definition.id, label: definition.label, definition }),
  ),
  ...CONFIG_DEFINITIONS.map((definition): NavEntry => ({ kind: 'config', id: definition.id, label: definition.label, definition })),
  { kind: 'kubernetes', id: KUBERNETES_DEFINITION.id, label: KUBERNETES_DEFINITION.label },
]

// Unlike getConfigDefinition, this never throws. `selected-config-id` lives in the user's
// browser and can outlive the entry it names - a schema file renamed or deleted, or a build
// shipped without a checklist. Falling back to the first pill turns what is currently an
// unrecoverable blank page into "you're on the first tab".
export function getNavEntry(id: string): NavEntry {
  return NAV_ENTRIES.find((entry) => entry.id === id) ?? NAV_ENTRIES[0]
}

export function navStatus(entry: NavEntry): DraftStatus {
  switch (entry.kind) {
    case 'config':
      return getDraftStatus(entry.definition)
    case 'onboarding':
      return getOnboardingStatus(entry.definition)
    case 'kubernetes':
      return getKubernetesStatus()
  }
}

// Every pill a step's `config` action may point at - i.e. everything except the checklist
// itself, which is where such a step already lives.
export const LINKABLE_PILL_IDS = NAV_ENTRIES.filter((e) => e.kind !== 'onboarding').map((e) => e.id)
