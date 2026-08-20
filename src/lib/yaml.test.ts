import { describe, expect, it } from 'vitest'
import { dataToYaml, parseYaml } from './yaml'
import { getConfigDefinition } from '../configs'

// Config shapes are generated from JSON Schema now (see src/configs/json-schema.ts), so there's
// no static TS type to import here - a plain object literal exercises the same schema.
const tenantConfigSchema = getConfigDefinition('tenant-config').schema

const validConfig = {
  tenant: 'acme',
  product: 'checkout',
  proxyEntries: ['*.github.com'],
  githubTopics: [{ method: 'artefact', name: 'billing', description: 'Billing service' }],
}

const parseConfig = (source: string) => parseYaml(tenantConfigSchema, source)

describe('dataToYaml / parseYaml', () => {
  it('round-trips a valid config', () => {
    const yaml = dataToYaml(validConfig)
    const result = parseConfig(yaml)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual(validConfig)
    }
  })

  it('rejects a tenant name longer than 12 characters', () => {
    const result = parseConfig(dataToYaml({ ...validConfig, tenant: 'way-too-long-tenant' }))
    expect(result.success).toBe(false)
  })

  it('rejects a proxy entry that is not a domain', () => {
    const result = parseConfig(dataToYaml({ ...validConfig, proxyEntries: ['not a domain'] }))
    expect(result.success).toBe(false)
  })

  it('rejects an unknown github topic method', () => {
    const result = parseConfig('tenant: acme\nproduct: checkout\nproxyEntries:\n  - "*.github.com"\ngithubTopics:\n  - method: bogus\n    name: billing\n    description: Billing service\n')
    expect(result.success).toBe(false)
  })

  it('surfaces a YAML syntax error distinctly from a schema error', () => {
    const result = parseConfig('tenant: [unterminated')
    expect(result.success).toBe(false)
    expect(result.success === false && 'yamlError' in result).toBe(true)
  })
})
