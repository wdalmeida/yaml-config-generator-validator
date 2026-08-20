import { describe, expect, it } from 'vitest'
import { configDefinitionFromJsonSchema, type ConfigJsonSchema } from './json-schema'

describe('configDefinitionFromJsonSchema', () => {
  it('reads id/label/filename from the root x- extensions and title', () => {
    const definition = configDefinitionFromJsonSchema({
      title: 'Widgets',
      'x-config-id': 'widgets',
      'x-default-filename': 'widgets.yml',
      type: 'object',
      properties: { name: { type: 'string', title: 'Name', minLength: 1 } },
      required: ['name'],
    })
    expect(definition.id).toBe('widgets')
    expect(definition.label).toBe('Widgets')
    expect(definition.defaultFilename).toBe('widgets.yml')
  })

  it('builds a strict enum for a plain enum string field, rejecting values outside it', () => {
    const definition = configDefinitionFromJsonSchema({
      title: 'T',
      'x-config-id': 't',
      'x-default-filename': 't.yml',
      type: 'object',
      properties: { method: { type: 'string', title: 'Method', enum: ['a', 'b'] } },
      required: ['method'],
    })
    expect(definition.fields).toEqual([{ key: 'method', label: 'Method', type: 'select', options: ['a', 'b'] }])
    expect(definition.schema.safeParse({ method: 'a' }).success).toBe(true)
    expect(definition.schema.safeParse({ method: 'c' }).success).toBe(false)
  })

  it('select-or-text: enum is suggested options only, any string within maxLength is valid', () => {
    const definition = configDefinitionFromJsonSchema({
      title: 'T',
      'x-config-id': 't',
      'x-default-filename': 't.yml',
      type: 'object',
      properties: {
        tenant: {
          type: 'string',
          title: 'Tenant',
          minLength: 1,
          maxLength: 12,
          enum: ['acme', 'globex'],
          'x-widget': 'select-or-text',
        },
      },
      required: ['tenant'],
    })
    expect(definition.fields).toEqual([
      { key: 'tenant', label: 'Tenant', type: 'select-or-text', options: ['acme', 'globex'], maxLength: 12 },
    ])
    expect(definition.schema.safeParse({ tenant: 'acme' }).success).toBe(true)
    expect(definition.schema.safeParse({ tenant: 'brand-new-co' }).success).toBe(true)
    expect(definition.schema.safeParse({ tenant: 'way-too-long-a-name' }).success).toBe(false)
    expect(definition.schema.safeParse({ tenant: '' }).success).toBe(false)
  })

  it('maps string minLength/maxLength/pattern to matching zod constraints', () => {
    const definition = configDefinitionFromJsonSchema({
      title: 'T',
      'x-config-id': 't',
      'x-default-filename': 't.yml',
      type: 'object',
      properties: {
        domain: { type: 'string', title: 'Domain', minLength: 1, pattern: '^\\*\\.[a-z]+\\.com$' },
      },
      required: ['domain'],
    })
    expect(definition.schema.safeParse({ domain: '*.github.com' }).success).toBe(true)
    expect(definition.schema.safeParse({ domain: 'not-a-match' }).success).toBe(false)
    expect(definition.schema.safeParse({ domain: '' }).success).toBe(false)
  })

  it('maps integer minimum/maximum to a ranged, integer-only zod number', () => {
    const definition = configDefinitionFromJsonSchema({
      title: 'T',
      'x-config-id': 't',
      'x-default-filename': 't.yml',
      type: 'object',
      properties: { count: { type: 'integer', title: 'Count', minimum: 1, maximum: 6 } },
      required: ['count'],
    })
    expect(definition.fields).toEqual([{ key: 'count', label: 'Count', type: 'number' }])
    expect(definition.schema.safeParse({ count: 3 }).success).toBe(true)
    expect(definition.schema.safeParse({ count: 0 }).success).toBe(false)
    expect(definition.schema.safeParse({ count: 7 }).success).toBe(false)
    expect(definition.schema.safeParse({ count: 1.5 }).success).toBe(false)
  })

  it('maps a boolean field straight through', () => {
    const definition = configDefinitionFromJsonSchema({
      title: 'T',
      'x-config-id': 't',
      'x-default-filename': 't.yml',
      type: 'object',
      properties: { enabled: { type: 'boolean', title: 'Enabled' } },
      required: ['enabled'],
    })
    expect(definition.fields).toEqual([{ key: 'enabled', label: 'Enabled', type: 'boolean' }])
    expect(definition.schema.safeParse({ enabled: true }).success).toBe(true)
    expect(definition.schema.safeParse({ enabled: 'true' }).success).toBe(false)
  })

  it('maps an array of strings to list-string with minItems enforced', () => {
    const definition = configDefinitionFromJsonSchema({
      title: 'T',
      'x-config-id': 't',
      'x-default-filename': 't.yml',
      type: 'object',
      properties: {
        branches: {
          type: 'array',
          title: 'Branches',
          minItems: 1,
          items: { type: 'string', minLength: 1, 'x-placeholder': 'main' },
        },
      },
      required: ['branches'],
    })
    expect(definition.fields).toEqual([{ key: 'branches', label: 'Branches', type: 'list-string', placeholder: 'main' }])
    expect(definition.schema.safeParse({ branches: ['main'] }).success).toBe(true)
    expect(definition.schema.safeParse({ branches: [] }).success).toBe(false)
  })

  it('maps an array of objects to list-object with nested fields and required checks intact', () => {
    const definition = configDefinitionFromJsonSchema({
      title: 'T',
      'x-config-id': 't',
      'x-default-filename': 't.yml',
      type: 'object',
      properties: {
        variables: {
          type: 'array',
          title: 'Variables',
          minItems: 1,
          'x-item-label': 'variable',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', title: 'Name', minLength: 1 },
              secret: { type: 'boolean', title: 'Secret' },
            },
            required: ['name', 'secret'],
          },
        },
      },
      required: ['variables'],
    })
    expect(definition.fields).toEqual([
      {
        key: 'variables',
        label: 'Variables',
        type: 'list-object',
        itemLabel: 'variable',
        itemFields: [
          { key: 'name', label: 'Name', type: 'text', placeholder: undefined },
          { key: 'secret', label: 'Secret', type: 'boolean' },
        ],
      },
    ])
    expect(definition.schema.safeParse({ variables: [{ name: 'API_URL', secret: false }] }).success).toBe(true)
    expect(definition.schema.safeParse({ variables: [{ name: '', secret: false }] }).success).toBe(false)
    expect(definition.schema.safeParse({ variables: [] }).success).toBe(false)
  })

  it('marks a property not in required[] as optional, and renders it as toggle-text', () => {
    const schema: ConfigJsonSchema = {
      title: 'T',
      'x-config-id': 't',
      'x-default-filename': 't.yml',
      type: 'object',
      properties: {
        name: { type: 'string', title: 'Name', minLength: 1 },
        nickname: { type: 'string', title: 'Nickname', minLength: 1, 'x-placeholder': 'nick' },
      },
      required: ['name'],
    }
    const definition = configDefinitionFromJsonSchema(schema)
    expect(definition.fields).toEqual([
      { key: 'name', label: 'Name', type: 'text', placeholder: undefined },
      { key: 'nickname', label: 'Nickname', type: 'toggle-text', placeholder: 'nick' },
    ])
    // Absent entirely -> valid (unchecked). Present but empty -> invalid (ticked, not yet typed).
    expect(definition.schema.safeParse({ name: 'a' }).success).toBe(true)
    expect(definition.schema.safeParse({ name: 'a', nickname: '' }).success).toBe(false)
    expect(definition.schema.safeParse({ name: 'a', nickname: 'bob' }).success).toBe(true)
    expect(definition.schema.safeParse({}).success).toBe(false)
  })

  it('x-computed-groups replaces its target properties with one computed-toggle-group field', () => {
    const schema: ConfigJsonSchema = {
      title: 'T',
      'x-config-id': 't',
      'x-default-filename': 't.yml',
      type: 'object',
      properties: {
        registryDocker: { type: 'string', title: 'Docker registry', minLength: 1 },
        registryMaven: { type: 'string', title: 'Maven registry', minLength: 1 },
      },
      required: [],
      'x-computed-groups': [
        {
          label: 'Registry name',
          placeholder: 'myregistry',
          targets: [
            { key: 'registryDocker', label: 'Docker', suffix: 'docker' },
            { key: 'registryMaven', label: 'Maven', suffix: 'maven' },
          ],
        },
      ],
    }
    const definition = configDefinitionFromJsonSchema(schema)

    // No standalone registryDocker/registryMaven fields - only the one group field.
    expect(definition.fields).toEqual([
      {
        key: 'computed-group-0',
        label: 'Registry name',
        type: 'computed-toggle-group',
        placeholder: 'myregistry',
        targets: [
          { key: 'registryDocker', label: 'Docker', suffix: 'docker' },
          { key: 'registryMaven', label: 'Maven', suffix: 'maven' },
        ],
      },
    ])

    // The underlying properties are still validated exactly as declared - grouping only
    // changes how the form populates them, not what's a valid final value.
    expect(definition.schema.safeParse({}).success).toBe(true)
    expect(definition.schema.safeParse({ registryDocker: 'myregistry-docker' }).success).toBe(true)
    expect(definition.schema.safeParse({ registryDocker: '' }).success).toBe(false)
  })
})
