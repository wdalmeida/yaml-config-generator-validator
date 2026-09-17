import { describe, expect, it } from 'vitest'
import YAML from 'yaml'
import { namespaceFor, renderManifests } from './manifests'

function docsOf(yaml: string) {
  return YAML.parseAllDocuments(yaml).map((d) => d.toJS() as Record<string, unknown>)
}

function rendered(tenant = 'acme', product = 'widgets') {
  const result = renderManifests({ tenant, product })
  if (!result.success) throw new Error(`expected success, got: ${result.issues.join('; ')}`)
  return result
}

describe('namespaceFor', () => {
  it('joins tenant and product, ignoring surrounding whitespace', () => {
    expect(namespaceFor({ tenant: '  acme ', product: ' widgets ' })).toBe('acme-widgets')
  })
})

describe('renderManifests', () => {
  it('asks for both inputs before rendering anything', () => {
    expect(renderManifests({ tenant: '', product: 'widgets' })).toEqual({
      success: false,
      issues: ['Enter a tenant and a product to render the resources.'],
    })
    expect(renderManifests({ tenant: 'acme', product: '   ' }).success).toBe(false)
  })

  it('emits one multi-document stream with every resource', () => {
    const kinds = docsOf(rendered().yaml).map((d) => d.kind)
    expect(kinds).toEqual(['Namespace', 'ServiceAccount', 'ServiceAccount', 'Role', 'RoleBinding', 'Secret', 'Secret'])
  })

  it('names and scopes every resource from the two inputs', () => {
    const result = rendered()
    expect(result.namespace).toBe('acme-widgets')

    const docs = docsOf(result.yaml)
    const namespaced = docs.filter((d) => d.kind !== 'Namespace')
    for (const doc of namespaced) {
      expect((doc.metadata as Record<string, unknown>).namespace).toBe('acme-widgets')
      expect((doc.metadata as Record<string, string>).name).toMatch(/^acme-widgets-/)
    }
    expect((docs[0].metadata as Record<string, unknown>).labels).toEqual({ tenant: 'acme', product: 'widgets' })
  })

  it('binds the Role to both service accounts', () => {
    const docs = docsOf(rendered().yaml)
    const binding = docs.find((d) => d.kind === 'RoleBinding')!
    const accounts = docs.filter((d) => d.kind === 'ServiceAccount').map((d) => (d.metadata as Record<string, string>).name)

    expect((binding.roleRef as Record<string, string>).name).toBe('acme-widgets-role')
    expect((binding.subjects as Record<string, string>[]).map((s) => s.name)).toEqual(accounts)
  })

  it('gives each service account its own token Secret, annotated back to it', () => {
    const docs = docsOf(rendered().yaml)
    const secrets = docs.filter((d) => d.kind === 'Secret')

    expect(secrets).toHaveLength(2)
    for (const secret of secrets) {
      const metadata = secret.metadata as Record<string, Record<string, string>>
      expect(secret.type).toBe('kubernetes.io/service-account-token')
      expect(metadata.name).toBe(`${metadata.annotations['kubernetes.io/service-account.name']}-token`)
    }
  })

  // The output is guesswork and says so in the stream itself, not only in the app's UI - the
  // warning has to survive a copy/paste into a terminal.
  it('carries its placeholder warning in the YAML itself', () => {
    const yaml = rendered().yaml
    expect(yaml).toContain('# PLACEHOLDER')
    expect(yaml.match(/# TODO: confirm/g)!.length).toBeGreaterThanOrEqual(4)
  })

  describe('name validation', () => {
    it('reports an invalid namespace once, not once per derived name', () => {
      const result = renderManifests({ tenant: 'Acme', product: 'widgets' })
      expect(result.success).toBe(false)
      expect(!result.success && result.issues).toHaveLength(1)
      expect(!result.success && result.issues[0]).toMatch(/^Namespace "Acme-widgets" isn't a valid Kubernetes name/)
    })

    it('rejects names over the 63-character limit rather than emitting something kubectl refuses', () => {
      const result = renderManifests({ tenant: 'acme', product: 'w'.repeat(70) })
      expect(result.success).toBe(false)
      expect(!result.success && result.issues.some((i) => /limited to 63/.test(i))).toBe(true)
    })

    it('catches a namespace that fits but whose derived service account name does not', () => {
      // A 55-character namespace is legal; "-deployer" pushes the service account to 64.
      const result = renderManifests({ tenant: 'acme', product: 'w'.repeat(50) })
      expect(result.success).toBe(false)
      expect(!result.success && result.issues.some((i) => i.startsWith('Service account'))).toBe(true)
    })

    it('catches a token Secret name that overflows even though its service account fits', () => {
      // 49-char namespace -> 58-char service account (legal) -> 64-char Secret (not).
      const result = renderManifests({ tenant: 'acme', product: 'w'.repeat(44) })
      expect(result.success).toBe(false)
      expect(!result.success && result.issues.every((i) => i.startsWith('Secret'))).toBe(true)
    })

    it('accepts hyphenated lowercase input', () => {
      expect(renderManifests({ tenant: 'acme-eu', product: 'widget-store' }).success).toBe(true)
    })
  })
})

describe('the API secret document', () => {
  const base = { tenant: 'acme', product: 'widgets' }

  it('is absent unless a value was entered, and blank counts as absent', () => {
    for (const apiSecret of [undefined, '', '   ']) {
      const result = renderManifests({ ...base, apiSecret })
      expect(result.success).toBe(true)
      if (result.success) expect(result.yaml).not.toContain('Opaque')
    }
  })

  it('carries the value verbatim, trimmed, under the documented key', () => {
    const result = renderManifests({ ...base, apiSecret: '  s3cret-value  ' })
    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.yaml).toContain('name: acme-widgets-api')
    expect(result.yaml).toContain('type: Opaque')
    expect(result.yaml).toContain('api_secret: s3cret-value')
  })

  // The derived-name rule the rest of this module already follows: each name is checked on its
  // own, because which suffix is longest is an accident of the current names.
  it('validates its own name length rather than trusting the namespace check', () => {
    const tenant = 'a'.repeat(30)
    const product = 'b'.repeat(29)
    const result = renderManifests({ tenant, product, apiSecret: 's3cret' })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.issues.join(' ')).toContain('API Secret')
  })
})

describe('the namespace override', () => {
  const base = { tenant: 'acme', product: 'widgets' }

  it('derives <tenant>-<product> when blank, absent or whitespace', () => {
    for (const namespace of [undefined, '', '   ']) {
      expect(namespaceFor({ ...base, namespace })).toBe('acme-widgets')
    }
  })

  it('uses the given name verbatim when there is one', () => {
    expect(namespaceFor({ ...base, namespace: '  team-platform  ' })).toBe('team-platform')
  })

  // The point of the override: every other name is derived from the namespace, so overriding it
  // has to move all of them rather than just relabelling the Namespace object.
  it('renames every derived object, not only the namespace', () => {
    const result = renderManifests({ ...base, namespace: 'team-platform', apiSecret: 's3cret' })
    expect(result.success).toBe(true)
    if (!result.success) return

    for (const name of [
      'name: team-platform',
      'name: team-platform-deployer',
      'name: team-platform-reader-token',
      'name: team-platform-role',
      'name: team-platform-rolebinding',
      'name: team-platform-api',
    ]) {
      expect(result.yaml).toContain(name)
    }
    expect(result.yaml).not.toContain('acme-widgets-')
  })

  // Tenant and product are the identity and still label the object; the override only renames it.
  it('keeps labelling the Namespace with the tenant and product', () => {
    const result = renderManifests({ ...base, namespace: 'team-platform' })
    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.yaml).toContain('tenant: acme')
    expect(result.yaml).toContain('product: widgets')
  })

  it('still requires a tenant and a product', () => {
    const result = renderManifests({ tenant: '', product: '', namespace: 'team-platform' })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.issues[0]).toContain('Enter a tenant and a product')
  })

  // A typed namespace is free text on the way in, exactly like the tenant, so it gets the same
  // check rather than being trusted because the user was specific about it.
  it('validates a given name as a DNS-1123 label', () => {
    const result = renderManifests({ ...base, namespace: 'Team_Platform' })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.issues.join(' ')).toContain('Namespace "Team_Platform"')
  })
})
