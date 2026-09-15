import type { DraftStatus, FieldDescriptor } from '../configs/types'
import { readPersistedState } from '../lib/persisted-state'
import { renderManifests } from './manifests'

// Not a *.schema.json config type: there's no file to push and no schema to validate against -
// the output is a rendered manifest stream you copy and `kubectl apply`. What it shares with a
// config type is the two inputs, declared as FieldDescriptors so FieldRow renders them and
// src/onboarding/seed.ts can seed them exactly as it seeds a config draft.
export const KUBERNETES_ID = 'kubernetes'

export const KUBERNETES_FIELDS: FieldDescriptor[] = [
  // maxLength matches tenant-config's own bound, so the same value is valid in both places.
  { key: 'tenant', label: 'Tenant', type: 'text', placeholder: 'acme' },
  { key: 'product', label: 'Product', type: 'text', placeholder: 'product name' },
]

export const KUBERNETES_DEFINITION = {
  id: KUBERNETES_ID,
  label: 'Kubernetes',
  fields: KUBERNETES_FIELDS,
}

export interface KubernetesDraft {
  tenant: string
  product: string
}

export function emptyKubernetesDraft(): KubernetesDraft {
  return { tenant: '', product: '' }
}

export function kubernetesDraftKey(): string {
  // Deliberately the same `draft:<id>` shape the config types use, so seeding writes it the
  // same way and there's one storage convention rather than two.
  return `draft:${KUBERNETES_ID}`
}

export function getKubernetesStatus(draft: KubernetesDraft = readKubernetesDraft()): DraftStatus {
  if (renderManifests(draft).success) return 'valid'
  return draft.tenant.trim() || draft.product.trim() ? 'draft' : 'empty'
}

export function readKubernetesDraft(): KubernetesDraft {
  const stored = readPersistedState<Partial<KubernetesDraft>>(kubernetesDraftKey(), emptyKubernetesDraft)
  return { tenant: String(stored?.tenant ?? ''), product: String(stored?.product ?? '') }
}

export { renderManifests, namespaceFor, type ManifestResult } from './manifests'
