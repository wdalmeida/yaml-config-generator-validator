import { describe, expect, it } from 'vitest'
import { configToYaml, parseYamlConfig } from './yaml'
import type { Config } from '../schema/config'

const validConfig: Config = {
  tenant: 'acme',
  product: 'checkout',
  proxyEntries: ['*.github.com'],
  githubTopics: [{ method: 'artefact', name: 'billing', description: 'Billing service' }],
}

describe('configToYaml / parseYamlConfig', () => {
  it('round-trips a valid config', () => {
    const yaml = configToYaml(validConfig)
    const result = parseYamlConfig(yaml)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual(validConfig)
    }
  })

  it('rejects a tenant name longer than 12 characters', () => {
    const result = parseYamlConfig(configToYaml({ ...validConfig, tenant: 'way-too-long-tenant' }))
    expect(result.success).toBe(false)
  })

  it('rejects a proxy entry that is not a domain', () => {
    const result = parseYamlConfig(configToYaml({ ...validConfig, proxyEntries: ['not a domain'] }))
    expect(result.success).toBe(false)
  })

  it('rejects an unknown github topic method', () => {
    const result = parseYamlConfig('tenant: acme\nproduct: checkout\nproxyEntries:\n  - "*.github.com"\ngithubTopics:\n  - method: bogus\n    name: billing\n    description: Billing service\n')
    expect(result.success).toBe(false)
  })

  it('surfaces a YAML syntax error distinctly from a schema error', () => {
    const result = parseYamlConfig('tenant: [unterminated')
    expect(result.success).toBe(false)
    expect(result.success === false && 'yamlError' in result).toBe(true)
  })
})
