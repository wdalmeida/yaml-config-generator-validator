import { z, type ZodType, type ZodTypeAny } from 'zod'
import type { ConfigDefinition, FieldDescriptor } from './types'

// The subset of JSON Schema (https://json-schema.org/draft/2020-12/schema) this app
// understands. Deliberately narrow - just enough to describe the config files we generate:
// object/properties/required, string (minLength/maxLength/pattern/enum), integer/number
// (minimum/maximum), boolean, array (items/minItems). No $ref, no oneOf/anyOf/allOf, no
// conditionals. If a real need for one of those comes up, extend this file - don't work
// around it in a config's schema.
//
// `x-*` keys are vendor extensions (explicitly legal in JSON Schema - unknown keys are
// ignored by any conforming validator) used only for UI hints JSON Schema has no keyword
// for: which widget to render, a placeholder, and the singular noun for a list-object's
// "Add ___" button.

interface JsonSchemaStringProp {
  type: 'string'
  // Optional because an array's scalar `items` schema (e.g. a list-string field) doesn't need
  // its own title - the array's own `title` is what becomes the field label.
  title?: string
  minLength?: number
  maxLength?: number
  pattern?: string
  enum?: string[]
  'x-widget'?: 'select-or-text'
  'x-placeholder'?: string
}

interface JsonSchemaNumberProp {
  type: 'integer' | 'number'
  title: string
  minimum?: number
  maximum?: number
}

interface JsonSchemaBooleanProp {
  type: 'boolean'
  title: string
}

interface JsonSchemaObjectProp {
  type: 'object'
  properties: Record<string, JsonSchemaProperty>
  required?: string[]
}

interface JsonSchemaArrayProp {
  type: 'array'
  title: string
  items: JsonSchemaStringProp | JsonSchemaObjectProp
  minItems?: number
  'x-item-label'?: string
}

export type JsonSchemaProperty = JsonSchemaStringProp | JsonSchemaNumberProp | JsonSchemaBooleanProp | JsonSchemaArrayProp

// A root-level `x-computed-groups` entry turns a set of otherwise-normal optional string
// properties (still validated exactly as declared in `properties`) into one shared base input
// plus a checkbox per target - see the `computed-toggle-group` FieldDescriptor and
// docs/adding-a-schema.md. The target properties must still exist in `properties` (that's what
// defines their validation and their real output key); this only changes how the *form*
// populates them.
export interface JsonSchemaComputedGroup {
  label: string
  placeholder?: string
  targets: { key: string; label: string; suffix: string }[]
}

export interface ConfigJsonSchema {
  $schema?: string
  title: string
  'x-config-id': string
  'x-default-filename': string
  type: 'object'
  properties: Record<string, JsonSchemaProperty>
  required?: string[]
  'x-computed-groups'?: JsonSchemaComputedGroup[]
}

function fieldFromProperty(key: string, prop: JsonSchemaProperty, required: boolean): FieldDescriptor {
  // prop.title is always set for named (object-property) fields in practice - the fallback to
  // `key` only matters for the unusual case of a hand-edited schema that omits it.
  switch (prop.type) {
    case 'string':
      if (prop.enum && prop['x-widget'] === 'select-or-text') {
        return { key, label: prop.title ?? key, type: 'select-or-text', options: prop.enum, maxLength: prop.maxLength }
      }
      if (prop.enum) {
        return { key, label: prop.title ?? key, type: 'select', options: prop.enum }
      }
      // A plain string not in the schema's `required` array becomes a tick-to-reveal field:
      // unchecked means the key is entirely absent from the output, not just an empty string.
      // See docs/adding-a-schema.md.
      return {
        key,
        label: prop.title ?? key,
        type: required ? 'text' : 'toggle-text',
        placeholder: prop['x-placeholder'],
      }
    case 'integer':
    case 'number':
      return { key, label: prop.title, type: 'number' }
    case 'boolean':
      return { key, label: prop.title, type: 'boolean' }
    case 'array':
      if (prop.items.type === 'object') {
        return {
          key,
          label: prop.title,
          type: 'list-object',
          itemLabel: prop['x-item-label'] ?? 'item',
          itemFields: fieldsFromProperties(prop.items),
        }
      }
      return { key, label: prop.title, type: 'list-string', placeholder: prop.items['x-placeholder'] }
  }
}

function fieldsFromProperties(schema: JsonSchemaObjectProp): FieldDescriptor[] {
  const required = new Set(schema.required ?? [])
  return Object.entries(schema.properties).map(([key, prop]) => fieldFromProperty(key, prop, required.has(key)))
}

function zodFromProperty(prop: JsonSchemaProperty): ZodTypeAny {
  switch (prop.type) {
    case 'string': {
      // Even with `enum`, `x-widget: select-or-text` means the enum is only suggested
      // options - any string (within the length bounds) is valid, so it stays a plain
      // string rather than a strict z.enum().
      if (prop.enum && prop['x-widget'] !== 'select-or-text') {
        return z.enum(prop.enum as [string, ...string[]])
      }
      const label = prop.title ?? 'This field'
      let s = z.string().trim().min(prop.minLength ?? 0, `${label} is required`)
      if (prop.maxLength !== undefined) s = s.max(prop.maxLength, `${label} must be ${prop.maxLength} characters or fewer`)
      if (prop.pattern !== undefined) s = s.regex(new RegExp(prop.pattern), `${label} has an invalid format`)
      return s
    }
    case 'integer':
    case 'number': {
      let n = prop.type === 'integer' ? z.number().int() : z.number()
      if (prop.minimum !== undefined) n = n.min(prop.minimum)
      if (prop.maximum !== undefined) n = n.max(prop.maximum)
      return n
    }
    case 'boolean':
      return z.boolean()
    case 'array': {
      const itemSchema = prop.items.type === 'object' ? zodFromObjectProperties(prop.items) : zodFromProperty(prop.items)
      let arr = z.array(itemSchema)
      if (prop.minItems !== undefined) {
        const noun = prop['x-item-label'] ?? 'entry'
        arr = arr.min(prop.minItems, `At least ${prop.minItems} ${noun}${prop.minItems === 1 ? '' : 's'} required`)
      }
      return arr
    }
  }
}

function zodFromObjectProperties(schema: JsonSchemaObjectProp): ZodTypeAny {
  const required = new Set(schema.required ?? [])
  const shape: Record<string, ZodTypeAny> = {}
  for (const [key, prop] of Object.entries(schema.properties)) {
    const propSchema = zodFromProperty(prop)
    shape[key] = required.has(key) ? propSchema : propSchema.optional()
  }
  return z.object(shape)
}

export function configDefinitionFromJsonSchema(schema: ConfigJsonSchema): ConfigDefinition {
  const groups = schema['x-computed-groups'] ?? []
  const groupTargetKeys = new Set(groups.flatMap((group) => group.targets.map((target) => target.key)))
  const required = new Set(schema.required ?? [])

  // Properties covered by a computed group still get their normal zod validator (via
  // zodFromObjectProperties below, unaffected by grouping) but are skipped here so they don't
  // also get a redundant standalone text field - the group field replaces them in the form.
  const plainFields = Object.entries(schema.properties)
    .filter(([key]) => !groupTargetKeys.has(key))
    .map(([key, prop]) => fieldFromProperty(key, prop, required.has(key)))

  const groupFields: FieldDescriptor[] = groups.map((group, index) => ({
    key: `computed-group-${index}`,
    label: group.label,
    type: 'computed-toggle-group',
    placeholder: group.placeholder,
    targets: group.targets,
  }))

  return {
    id: schema['x-config-id'],
    label: schema.title,
    defaultFilename: schema['x-default-filename'],
    // Cast: a schema built dynamically from JSON can't carry a precise literal TS type the
    // way a hand-written zod schema can - ConfigDefinition's default `Record<string, unknown>`
    // is the honest type here.
    schema: zodFromObjectProperties(schema) as ZodType<Record<string, unknown>>,
    fields: [...plainFields, ...groupFields],
  }
}
