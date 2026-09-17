import type { DraftStatus, FieldDescriptor } from '../configs/types'
import { clearSessionState, readPersistedState, readSessionState } from '../lib/persisted-state'
import { renderManifests, type ManifestInput } from './manifests'

// Not a *.schema.json config type: there's no file to push and no schema to validate against -
// the output is a rendered manifest stream you copy and `kubectl apply`. What it shares with a
// config type is the two inputs, declared as FieldDescriptors so FieldRow renders them and
// src/onboarding/seed.ts can seed them exactly as it seeds a config draft.
export const KUBERNETES_ID = 'kubernetes'

export const KUBERNETES_FIELDS: FieldDescriptor[] = [
  // maxLength matches tenant-config's own bound, so the same value is valid in both places.
  { key: 'tenant', label: 'Tenant', type: 'text', placeholder: 'acme' },
  { key: 'product', label: 'Product', type: 'text', placeholder: 'product name' },
  // Optional. Blank leaves the Secret out of the rendered stream entirely - see ManifestInput.
  { key: 'apiSecret', label: 'API secret', type: 'text', placeholder: 'paste the value here', secret: true },
]

export const KUBERNETES_DEFINITION = {
  id: KUBERNETES_ID,
  label: 'Kubernetes',
  fields: KUBERNETES_FIELDS,
}

// Which inputs may be written to localStorage - an allow-list of what to keep, deliberately, and
// NOT a deny-list of what to exclude. The two are not equivalent: this pill renders ServiceAccount
// token Secrets, and the resources it describes will eventually need a real secret value typed in
// (a registry credential, a pre-existing token). With a deny-list, adding that input would persist
// it by default and the mistake would be invisible - the value simply appears in storage, readable
// by any script on the origin and surviving the tab closing. With this allow-list, a new input is
// non-persisted until someone adds its key here, so the unsafe outcome requires a deliberate edit
// to a line that says what it costs. Adding a key here is asserting the value is not a secret.
export const PERSISTED_KUBERNETES_KEYS = ['tenant', 'product'] as const
export type PersistedKubernetesKey = (typeof PERSISTED_KUBERNETES_KEYS)[number]

// The second tier: sessionStorage, which is scoped to one tab and dropped when that tab closes.
// `apiSecret` is here rather than on the list above because losing it on every page refresh would
// be worse than useless - it would push people to keep the value somewhere more permanent and less
// careful, a note file or a chat message, which is the outcome this is trying to avoid. Surviving
// a reload and not surviving the tab is the trade that buys that without leaving it on the machine.
//
// Three tiers, and the default is the strictest one: a key on neither list is held in memory only.
export const SESSION_KUBERNETES_KEYS = ['apiSecret'] as const
export type SessionKubernetesKey = (typeof SESSION_KUBERNETES_KEYS)[number]

export interface KubernetesDraft {
  tenant: string
  product: string
  apiSecret: string
  // Inputs added later live here too. They are held in memory and rendered like any other -
  // they are simply not part of what `persistedKubernetesDraft` hands to storage.
  [key: string]: string
}

export type PersistedKubernetesDraft = Pick<KubernetesDraft, PersistedKubernetesKey>
export type SessionKubernetesDraft = Pick<KubernetesDraft, SessionKubernetesKey>

export function emptyKubernetesDraft(): KubernetesDraft {
  return { tenant: '', product: '', apiSecret: '' }
}

export function emptySessionKubernetesDraft(): SessionKubernetesDraft {
  return { apiSecret: '' }
}

// A separate storage key from the draft, not a field inside it. Two reasons: clearing the secret
// is then a removeItem rather than a rewrite of a shared blob (nothing is left behind to read),
// and the two live in different stores, so merging them into one record would mean writing half
// of it to each and reassembling on read.
export function kubernetesSecretKey(): string {
  return `secret:${KUBERNETES_ID}`
}

export function kubernetesDraftKey(): string {
  // Deliberately the same `draft:<id>` shape the config types use, so seeding writes it the
  // same way and there's one storage convention rather than two.
  return `draft:${KUBERNETES_ID}`
}

// Narrows a draft to exactly the keys that may be stored, derived from the allow-list itself so
// there is one source of truth rather than a second hand-written list to keep in sync. Unknown
// keys are dropped rather than passed through, which also scrubs anything an older build (or a
// hand-edited localStorage) left behind under this key.
export function persistedKubernetesDraft(draft: Partial<Record<string, unknown>>): PersistedKubernetesDraft {
  const persisted = {} as PersistedKubernetesDraft
  for (const key of PERSISTED_KUBERNETES_KEYS) persisted[key] = String(draft[key] ?? '')
  return persisted
}

export function sessionKubernetesDraft(draft: Partial<Record<string, unknown>>): SessionKubernetesDraft {
  const session = {} as SessionKubernetesDraft
  for (const key of SESSION_KUBERNETES_KEYS) session[key] = String(draft[key] ?? '')
  return session
}

export function readKubernetesSecrets(): SessionKubernetesDraft {
  return sessionKubernetesDraft(
    readSessionState<Partial<Record<string, unknown>>>(kubernetesSecretKey(), emptySessionKubernetesDraft),
  )
}

export function clearKubernetesSecrets(): boolean {
  return clearSessionState(kubernetesSecretKey())
}

// The pill dot deliberately ignores the secret: it is optional, so a namespace with no API secret
// is a complete answer, and reading sessionStorage to badge a pill would make the dot mean
// something different in a second tab.
export function getKubernetesStatus(draft: ManifestInput = readKubernetesDraft()): DraftStatus {
  if (renderManifests(draft).success) return 'valid'
  return draft.tenant.trim() || draft.product.trim() ? 'draft' : 'empty'
}

export function readKubernetesDraft(): PersistedKubernetesDraft {
  return persistedKubernetesDraft(
    readPersistedState<Partial<Record<string, unknown>>>(kubernetesDraftKey(), emptyKubernetesDraft),
  )
}

export { renderManifests, namespaceFor, type ManifestInput, type ManifestResult } from './manifests'
