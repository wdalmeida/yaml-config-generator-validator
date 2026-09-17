import { beforeEach, describe, expect, it } from 'vitest'
import {
  emptyKubernetesDraft,
  sessionKubernetesDraft,
  SESSION_KUBERNETES_KEYS,
  getKubernetesStatus,
  kubernetesDraftKey,
  persistedKubernetesDraft,
  PERSISTED_KUBERNETES_KEYS,
  readKubernetesDraft,
} from './index'

describe('the Kubernetes persistence allow-list', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  // Pinned on purpose. This list is the whole security boundary for this pill: a key on it is
  // written to localStorage, where any script on the origin can read it and where it outlives the
  // tab. Adding one is asserting "this value is not a secret", which is a decision worth making
  // in a review rather than by autocomplete - so growing the list has to break a test first.
  it('contains exactly the two values that are not secrets', () => {
    expect(PERSISTED_KUBERNETES_KEYS).toEqual(['tenant', 'product'])
  })

  // The single most important assertion in this file: apiSecret is a secret by construction, and
  // the list above is what decides whether it outlives the tab. A refactor that "tidied up" the
  // three tiers into one would show up here first.
  it('does not contain the API secret', () => {
    expect(PERSISTED_KUBERNETES_KEYS).not.toContain('apiSecret')
    expect(SESSION_KUBERNETES_KEYS).toEqual(['apiSecret'])
    expect(persistedKubernetesDraft({ tenant: 'acme', product: 'widgets', apiSecret: 's3cret' })).toEqual({
      tenant: 'acme',
      product: 'widgets',
    })
  })

  it('narrows the session tier the same way, and in the other direction', () => {
    expect(sessionKubernetesDraft({ tenant: 'acme', product: 'widgets', apiSecret: 's3cret' })).toEqual({
      apiSecret: 's3cret',
    })
    expect(sessionKubernetesDraft({})).toEqual({ apiSecret: '' })
  })

  it('drops any key that is not on the list', () => {
    const narrowed = persistedKubernetesDraft({
      tenant: 'acme',
      product: 'widgets',
      registryToken: 'ghp_SUPERSECRET123',
    })

    expect(narrowed).toEqual({ tenant: 'acme', product: 'widgets' })
    expect(JSON.stringify(narrowed)).not.toContain('SUPERSECRET')
  })

  it('coerces a missing or non-string value rather than passing it through', () => {
    expect(persistedKubernetesDraft({})).toEqual({ tenant: '', product: '' })
    expect(persistedKubernetesDraft({ tenant: 7, product: null })).toEqual({ tenant: '7', product: '' })
  })

  // The read side matters as much as the write side: a build that once persisted a secret would
  // otherwise hand it straight back into component state, where the next write returns it to
  // storage. Narrowing on read is what makes the fix retroactive for anyone who already has one.
  it('does not read back a key an older build may have left in storage', () => {
    localStorage.setItem(
      `yaml-config-generator:${kubernetesDraftKey()}`,
      JSON.stringify({ tenant: 'acme', product: 'widgets', registryToken: 'ghp_SUPERSECRET123' }),
    )

    expect(readKubernetesDraft()).toEqual({ tenant: 'acme', product: 'widgets' })
  })

  it('keeps the pill status independent of the secret, which is optional', () => {
    expect(getKubernetesStatus({ tenant: 'acme', product: 'widgets' })).toBe('valid')
    expect(getKubernetesStatus({ tenant: 'acme', product: 'widgets', apiSecret: 's3cret' })).toBe('valid')
  })

  it('still reports the pill status from what it did read', () => {
    expect(getKubernetesStatus(emptyKubernetesDraft())).toBe('empty')
    expect(getKubernetesStatus({ tenant: 'acme', product: '' })).toBe('draft')
    expect(getKubernetesStatus({ tenant: 'acme', product: 'widgets' })).toBe('valid')
  })
})
