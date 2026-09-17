import type { DraftStatus, FieldDescriptor } from '../configs/types'
import { readPersistedState } from '../lib/persisted-state'
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
  // Optional override. Blank derives `<tenant>-<product>` - see ManifestInput.namespace.
  { key: 'namespace', label: 'Namespace', type: 'text', placeholder: 'leave blank to derive it' },
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
export const PERSISTED_KUBERNETES_KEYS = ['tenant', 'product', 'namespace'] as const
export type PersistedKubernetesKey = (typeof PERSISTED_KUBERNETES_KEYS)[number]

// Fields the descriptors themselves mark as secret, derived rather than listed a second time, so
// adding `secret: true` to a field is the only edit needed to bring it under the rule below.
export const SECRET_KUBERNETES_KEYS = KUBERNETES_FIELDS.filter(
  (field) => field.type === 'text' && field.secret,
).map((field) => field.key)

// A secret is held in component state and nowhere else - not localStorage, and deliberately not
// sessionStorage either. sessionStorage was built for exactly this value and then taken back out:
// it is readable by any script on the origin for as long as the tab is open, so against the threat
// that matters here (a compromised dependency, an injected script, anything else running on the
// page) it offers no protection at all, and all it adds is a window during which the value is
// sitting somewhere a script can enumerate. Component state is not immune either, but it is not
// enumerable by key and it does not survive a reload.
//
// The cost is real and is the user's call, made explicitly: the secret is gone on reload, on
// navigating away, and on switching to another pill, because App mounts one workspace at a time.
// The UI says so next to the field rather than letting people discover it.
export interface KubernetesDraft {
  tenant: string
  product: string
  namespace: string
  // Never persisted - see SECRET_KUBERNETES_KEYS above.
  apiSecret: string
  // Inputs added later live here too. They are held in memory and rendered like any other -
  // they are simply not part of what `persistedKubernetesDraft` hands to storage.
  [key: string]: string
}

export type PersistedKubernetesDraft = Pick<KubernetesDraft, PersistedKubernetesKey>

export function emptyKubernetesDraft(): KubernetesDraft {
  return { tenant: '', product: '', namespace: '', apiSecret: '' }
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

// The pill dot deliberately ignores the secret: it is optional, so a namespace with no API secret
// is a complete answer - and there would be nothing to read anyway, since it is never stored.
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
