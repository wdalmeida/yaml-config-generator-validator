import { configDefinitionFromJsonSchema, type ConfigJsonSchema } from './json-schema'
import { readPersistedState } from '../lib/persisted-state'
import { draftHasContent, emptyDraftFor, parseDraft, type ConfigDefinition } from './types'

// Every *.schema.json file here becomes a config type automatically - no other code change
// needed to add one. `eager: true` bundles them at build time (this is a static site, there's
// no server to fetch them from at runtime).
const schemaModules = import.meta.glob('./schemas/*.schema.json', { eager: true }) as Record<
  string,
  { default: ConfigJsonSchema }
>

// Controls pill display order. A schema file not listed here still loads and works - it's
// just appended after the ones that are, so add an id here only if it needs a specific
// position rather than "at the end".
const DISPLAY_ORDER = ['tenant-config', 'ci', 'cd', 'env', 'protection']

export const CONFIG_DEFINITIONS: ConfigDefinition[] = Object.values(schemaModules)
  .map((module) => configDefinitionFromJsonSchema(module.default))
  .sort((a, b) => {
    const ai = DISPLAY_ORDER.indexOf(a.id)
    const bi = DISPLAY_ORDER.indexOf(b.id)
    if (ai === -1 && bi === -1) return a.id.localeCompare(b.id)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })

export function getConfigDefinition(id: string): ConfigDefinition {
  const definition = CONFIG_DEFINITIONS.find((d) => d.id === id)
  if (!definition) throw new Error(`Unknown config type: ${id}`)
  return definition
}

export type DraftStatus = 'empty' | 'draft' | 'valid'

// Reads a config type's persisted draft straight from localStorage (without mounting its
// form) to badge the type-switcher pills with progress, even for types not currently open.
export function getDraftStatus(definition: ConfigDefinition): DraftStatus {
  const draft = readPersistedState(`draft:${definition.id}`, emptyDraftFor(definition))
  if (parseDraft(definition, draft).success) return 'valid'
  return draftHasContent(definition, draft) ? 'draft' : 'empty'
}

export type { ConfigDefinition, FieldDescriptor } from './types'
export { emptyDraftFor, parseDraft } from './types'
