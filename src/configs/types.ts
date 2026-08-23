import type { ZodType } from 'zod'

export type FieldDescriptor =
  | { key: string; label: string; type: 'text'; placeholder?: string }
  | { key: string; label: string; type: 'number' }
  | { key: string; label: string; type: 'boolean' }
  | { key: string; label: string; type: 'select'; options: readonly string[] }
  // A picker that offers a fixed list of options plus a "custom" free-text alternative,
  // e.g. tenant: pick an existing one, or type a new one. `maxLength` bounds the free-text side.
  | { key: string; label: string; type: 'select-or-text'; options: readonly string[]; maxLength?: number }
  | { key: string; label: string; type: 'list-string'; placeholder?: string }
  | { key: string; label: string; type: 'list-object'; itemLabel: string; itemFields: FieldDescriptor[] }
  // An optional string gated by a checkbox: unchecked means the key is entirely absent from
  // the output (draft value `null`), checked reveals a text input (draft value a string, which
  // must still pass minLength/pattern etc. if non-empty). Used for e.g. a config's optional
  // per-registry name - see docs/adding-a-schema.md.
  | { key: string; label: string; type: 'toggle-text'; placeholder?: string }
  // One shared base text input plus a checkbox per target. The user types the base value once;
  // each ticked target computes its own output key as `${base}-${suffix}` - the user never
  // edits a target's value directly. Draft value is `{ base: string; ticked: Record<string,
  // boolean> }`. Unticked targets are entirely absent from the output, same as `toggle-text`.
  | {
      key: string
      label: string
      type: 'computed-toggle-group'
      placeholder?: string
      targets: { key: string; label: string; suffix: string }[]
    }

export interface ConfigDefinition<T = Record<string, unknown>> {
  id: string
  label: string
  defaultFilename: string
  schema: ZodType<T>
  fields: FieldDescriptor[]
}

// A single blank value for one field, used both to seed a fresh draft and to seed a new
// row inside a list-object field.
export function emptyValueFor(field: FieldDescriptor): unknown {
  switch (field.type) {
    case 'text':
      return ''
    case 'select':
    case 'select-or-text':
      // select-or-text defaults to the first known option (e.g. an existing tenant) rather
      // than blank, so the form opens ready to submit instead of forcing a "type a new one" step.
      return field.options[0] ?? ''
    case 'number':
      return 0
    case 'boolean':
      return false
    case 'list-string':
      return ['']
    case 'list-object':
      return [emptyObjectFor(field.itemFields)]
    case 'toggle-text':
      return null
    case 'computed-toggle-group':
      return { base: '', ticked: {} }
  }
}

interface ComputedToggleGroupValue {
  base: string
  ticked: Record<string, boolean>
}

export function emptyObjectFor(fields: FieldDescriptor[]): Record<string, unknown> {
  return Object.fromEntries(fields.map((field) => [field.key, emptyValueFor(field)]))
}

export function emptyDraftFor(definition: ConfigDefinition): Record<string, unknown> {
  return emptyObjectFor(definition.fields)
}

// Whether a single object (the top-level draft, or one row of a list-object) has any
// user-entered content at all, ignoring fields whose "unset" state can't be distinguished
// from "set to the default" (booleans, numbers, selects).
function objectHasContent(fields: FieldDescriptor[], value: Record<string, unknown>): boolean {
  return fields.some((field) => {
    const v = value[field.key]
    if (field.type === 'text' || field.type === 'select-or-text' || field.type === 'toggle-text') {
      return typeof v === 'string' && v.trim().length > 0
    }
    if (field.type === 'list-string') return Array.isArray(v) && v.some((entry) => typeof entry === 'string' && entry.trim().length > 0)
    if (field.type === 'list-object') {
      return Array.isArray(v) && v.some((row) => objectHasContent(field.itemFields, row as Record<string, unknown>))
    }
    if (field.type === 'computed-toggle-group') {
      const group = v as ComputedToggleGroupValue | undefined
      return Boolean(group?.base.trim()) || Object.values(group?.ticked ?? {}).some(Boolean)
    }
    return false
  })
}

export function draftHasContent(definition: ConfigDefinition, draft: Record<string, unknown>): boolean {
  return objectHasContent(definition.fields, draft)
}

// Strips blank rows/entries a user hasn't touched yet, so an untouched list field (which
// starts with one empty row for typing into) doesn't trigger "required" validation errors
// before the user has done anything.
export function draftToCandidate(fields: FieldDescriptor[], draft: Record<string, unknown>): Record<string, unknown> {
  const candidate: Record<string, unknown> = {}
  for (const field of fields) {
    const v = draft[field.key]
    if (field.type === 'list-string' && Array.isArray(v)) {
      candidate[field.key] = v.filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
    } else if (field.type === 'list-object' && Array.isArray(v)) {
      candidate[field.key] = v
        .filter((row) => objectHasContent(field.itemFields, row as Record<string, unknown>))
        .map((row) => draftToCandidate(field.itemFields, row as Record<string, unknown>))
    } else if (field.type === 'toggle-text') {
      // null = unchecked: omit the key entirely so the schema's `.optional()` sees it as
      // absent, rather than passing through a value that would fail e.g. minLength.
      if (v !== null) candidate[field.key] = v
    } else if (field.type === 'computed-toggle-group') {
      // This field's own key never appears in the candidate - it fans out into each ticked
      // target's own key instead. An empty base with a ticked target deliberately becomes ''
      // (not the computed value, and not omitted) so it surfaces as a normal "required" error
      // rather than silently emitting a garbled "-docker".
      const group = (v ?? { base: '', ticked: {} }) as ComputedToggleGroupValue
      const base = group.base?.trim() ?? ''
      for (const target of field.targets) {
        if (group.ticked?.[target.key]) {
          candidate[target.key] = base ? `${base}-${target.suffix}` : ''
        }
      }
    } else {
      candidate[field.key] = v
    }
  }
  return candidate
}

// The inverse of draftToCandidate: rebuilds a full draft object from schema-validated data
// (e.g. parsed from pasted/fetched YAML), so every field type round-trips back into the form -
// including computed-toggle-group, whose own key never appears in validated data (it's fanned
// out into its targets' keys instead, see draftToCandidate) and so can't just be spread in.
export function draftFromCandidate(fields: FieldDescriptor[], candidate: Record<string, unknown>): Record<string, unknown> {
  const draft: Record<string, unknown> = {}
  for (const field of fields) {
    if (field.type === 'list-object') {
      if (!(field.key in candidate)) {
        draft[field.key] = emptyValueFor(field)
      } else {
        const rows = candidate[field.key] as Record<string, unknown>[]
        draft[field.key] = rows.map((row) => draftFromCandidate(field.itemFields, row))
      }
    } else if (field.type === 'computed-toggle-group') {
      let base = ''
      const ticked: Record<string, boolean> = {}
      for (const target of field.targets) {
        const value = candidate[target.key]
        if (typeof value !== 'string') continue
        ticked[target.key] = true
        const suffix = `-${target.suffix}`
        if (!base && value.endsWith(suffix)) base = value.slice(0, -suffix.length)
      }
      draft[field.key] = { base, ticked }
    } else {
      draft[field.key] = field.key in candidate ? candidate[field.key] : emptyValueFor(field)
    }
  }
  return draft
}

export type DraftParseResult<T> = { success: true; data: T } | { success: false; issues: string[] }

export function parseDraft<T>(definition: ConfigDefinition<T>, draft: Record<string, unknown>): DraftParseResult<T> {
  const candidate = draftToCandidate(definition.fields, draft)
  const result = definition.schema.safeParse(candidate)
  if (result.success) return { success: true, data: result.data }
  return {
    success: false,
    issues: result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
  }
}
