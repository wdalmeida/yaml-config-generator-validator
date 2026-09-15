import { CONFIG_DEFINITIONS } from '../configs'
import { emptyDraftFor, emptyValueFor, type ConfigDefinition, type FieldDescriptor } from '../configs/types'
import { readPersistedState, writePersistedState } from '../lib/persisted-state'

// The onboarding-side allowlist. A config type opts in by naming a property `tenant` or
// `product`; this list is what stops some unrelated onboarding input becoming a seeding source
// by accident. Matching on the property name (rather than a table naming each config id) is
// what keeps "dropping in a new .schema.json file is the entire integration" true.
export const SEEDABLE_KEYS = ['tenant', 'product'] as const

// Only these two descriptor types hold a plain string as their whole draft value.
//
// `select` is excluded because FieldRow renders a value that isn't in `options` as the *first*
// option while state holds something else - the form would silently lie about its own value.
// `toggle-text` is excluded because writing a string there flips the key from absent to
// present, turning on an optional field the user never ticked. And a computed-toggle-group's
// targets aren't in `fields` at all (see json-schema.ts), so writing one would be dropped by
// draftToCandidate with no visible error whatsoever.
const SEEDABLE_TARGET_TYPES: ReadonlySet<FieldDescriptor['type']> = new Set(['text', 'select-or-text'])

export interface SeededField {
  key: string
  label: string
  value: string
  // Only set when the user had actually chosen something there before. Compared against the
  // field's *own* default rather than "is the draft non-empty": an untouched select-or-text
  // tenant already holds "acme" (its first enum option), so draftHasContent would call that
  // content and we'd claim to have replaced a value nobody ever typed.
  replaced?: string
}

export interface SeedResult {
  id: string
  label: string
  seeded: SeededField[]
}

// Merges the onboarding tenant/product into every config type's persisted draft, leaving every
// other key in those drafts alone. Returns one entry per type actually changed - a type with no
// matching field, a type already holding the same value, and a blank source value are all
// omitted, so the caller can report exactly what happened rather than implying more.
//
// Writing straight to localStorage is safe only because App mounts exactly one workspace at a
// time: while the onboarding pill is open, no ConfigWorkspace holds a draft in React state for
// this write to go stale against. Rendering onboarding alongside a workspace would break that -
// the mounted workspace's persist effect would write its pre-seed draft back over this.
export function seedConfigDrafts(
  values: Record<string, string>,
  definitions: ConfigDefinition[] = CONFIG_DEFINITIONS,
): SeedResult[] {
  const results: SeedResult[] = []

  for (const definition of definitions) {
    const key = `draft:${definition.id}`
    const draft = readPersistedState<Record<string, unknown>>(key, () => emptyDraftFor(definition))
    const next = { ...draft }
    const seeded: SeededField[] = []

    for (const seedKey of SEEDABLE_KEYS) {
      const value = (values[seedKey] ?? '').trim()
      // Blank means "not filled in yet", never "clear this everywhere" - and writing '' into a
      // select-or-text would replace a valid default with a value failing minLength.
      if (!value) continue

      const field = definition.fields.find((f) => f.key === seedKey)
      if (!field || !SEEDABLE_TARGET_TYPES.has(field.type)) continue

      const previous = next[seedKey]
      if (previous === value) continue

      const userChose = typeof previous === 'string' && previous.trim() !== '' && previous !== emptyValueFor(field)

      next[seedKey] = value
      seeded.push({ key: seedKey, label: field.label, value, replaced: userChose ? previous : undefined })
    }

    if (seeded.length === 0) continue
    if (!writePersistedState(key, next)) continue
    results.push({ id: definition.id, label: definition.label, seeded })
  }

  return results
}

// The receipt shown next to the button. Deliberately says only what actually happened - today
// only tenant-config has a tenant/product property, and the copy must not imply it touched all
// five config types.
export function describeSeedResults(results: SeedResult[]): string[] {
  if (results.length === 0) return ['Nothing to seed — no config type has a Tenant or Product field yet.']

  const lines = results.map((result) => `Seeded ${result.seeded.map((f) => f.label).join(', ')} into ${result.label}.`)
  for (const result of results) {
    for (const field of result.seeded) {
      if (field.replaced) lines.push(`Replaced ${field.label} in ${result.label} (was "${field.replaced}").`)
    }
  }
  return lines
}
