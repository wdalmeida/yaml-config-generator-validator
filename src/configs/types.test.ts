import { describe, expect, it } from 'vitest'
import { emptyDraftFor, parseDraft } from './types'
import { getConfigDefinition } from './index'
import tenantConfigSchema from './schemas/tenant-config.schema.json'

const tenantConfigDefinition = getConfigDefinition('tenant-config')
const envConfigDefinition = getConfigDefinition('env')
const ciConfigDefinition = getConfigDefinition('ci')
const firstTenant = tenantConfigSchema.properties.tenant.enum[0]

// ci.schema.json declares one x-computed-groups entry, so it gets one synthetic
// 'computed-group-0' field (see configDefinitionFromJsonSchema) backing registryDocker/registryMaven.
const validCiDraft = {
  runtime: 'node',
  runtimeVersion: '20',
  buildCommand: 'npm run build',
  testCommand: 'npm test',
  triggerBranches: ['main'],
  'computed-group-0': { base: '', ticked: {} },
}

describe('emptyDraftFor', () => {
  it('seeds one blank row per list field, and the first option for selects', () => {
    const draft = emptyDraftFor(tenantConfigDefinition)
    expect(draft).toEqual({
      tenant: firstTenant,
      product: '',
      proxyEntries: [''],
      githubTopics: [{ method: 'artefact', name: '', description: '' }],
    })
  })
})

describe('parseDraft', () => {
  it('fails on a completely untouched draft (all required fields blank)', () => {
    const draft = emptyDraftFor(tenantConfigDefinition)
    const result = parseDraft(tenantConfigDefinition, draft)
    expect(result.success).toBe(false)
  })

  it('succeeds once every field is filled in', () => {
    const draft = {
      tenant: 'acme',
      product: 'checkout',
      proxyEntries: ['*.github.com'],
      githubTopics: [{ method: 'artefact', name: 'billing', description: 'Billing service' }],
    }
    const result = parseDraft(tenantConfigDefinition, draft)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual(draft)
    }
  })

  it('strips untouched blank rows from list fields before validating', () => {
    const draft = {
      tenant: 'acme',
      product: 'checkout',
      proxyEntries: ['*.github.com', '', '   '],
      githubTopics: [
        { method: 'artefact', name: 'billing', description: 'Billing service' },
        { method: 'artefact', name: '', description: '' },
      ],
    }
    const result = parseDraft(tenantConfigDefinition, draft)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.proxyEntries).toEqual(['*.github.com'])
      expect(result.data.githubTopics).toHaveLength(1)
    }
  })

  it('treats a list-object row as blank even if only its boolean field is set', () => {
    const draft = {
      variables: [
        { name: '', value: '', secret: true },
        { name: 'API_URL', value: 'https://example.com', secret: false },
      ],
    }
    const result = parseDraft(envConfigDefinition, draft)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.variables).toEqual([{ name: 'API_URL', value: 'https://example.com', secret: false }])
    }
  })

  it('omits a computed-toggle-group target from the output entirely when its checkbox is unticked', () => {
    const result = parseDraft(ciConfigDefinition, validCiDraft)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).not.toHaveProperty('registryDocker')
      expect(result.data).not.toHaveProperty('registryMaven')
    }
  })

  it('computes a ticked target as `${base}-${suffix}`, independent of other targets', () => {
    const draft = { ...validCiDraft, 'computed-group-0': { base: 'myregistry', ticked: { registryDocker: true } } }
    const result = parseDraft(ciConfigDefinition, draft)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.registryDocker).toBe('myregistry-docker')
      expect(result.data).not.toHaveProperty('registryMaven')
    }
  })

  it('computes every ticked target off the same shared base value', () => {
    const draft = {
      ...validCiDraft,
      'computed-group-0': { base: 'myregistry', ticked: { registryDocker: true, registryMaven: true } },
    }
    const result = parseDraft(ciConfigDefinition, draft)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.registryDocker).toBe('myregistry-docker')
      expect(result.data.registryMaven).toBe('myregistry-maven')
    }
  })

  it('rejects a ticked target whose shared base value is still blank', () => {
    const draft = { ...validCiDraft, 'computed-group-0': { base: '', ticked: { registryDocker: true } } }
    const result = parseDraft(ciConfigDefinition, draft)
    expect(result.success).toBe(false)
  })
})
