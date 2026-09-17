import { lazy, Suspense, useEffect, useState } from 'react'
import { writePersistedState } from '../lib/persisted-state'
import {
  emptyKubernetesDraft,
  KUBERNETES_FIELDS,
  kubernetesDraftKey,
  persistedKubernetesDraft,
  readKubernetesDraft,
  namespaceFor,
  renderManifests,
  SECRET_KUBERNETES_KEYS,
  type KubernetesDraft,
} from '../kubernetes'
import { FieldRow } from './fields/FieldRow'

const YamlEditor = lazy(() => import('./YamlEditor'))

// Unlike ConfigWorkspace this is one-way: the manifests are rendered from the two inputs and
// there is nothing to sync back. Editing the output would be editing a template's result, so
// the field is read-only and there's no draft-from-YAML path at all - you copy it and apply it.
export function KubernetesWorkspace() {
  // Deliberately not usePersistedState. That hook writes back whatever the state object holds,
  // which makes persistence the default for every key the draft happens to carry - the wrong
  // default on the one pill whose inputs will eventually include a secret. Here the draft is
  // ordinary component state and the write is narrowed to the allow-list on the way out, so an
  // input that nobody has explicitly cleared for storage simply never reaches it.
  // Only the persisted half is read back on mount. A secret starts blank every time by design -
  // there is nowhere for it to have been kept.
  const [draft, setDraft] = useState<KubernetesDraft>(() => ({
    ...emptyKubernetesDraft(),
    ...readKubernetesDraft(),
  }))
  const [copied, setCopied] = useState(false)
  const [cleared, setCleared] = useState(false)

  // The one write, narrowed to the allow-list on the way out. A field not on that list - every
  // secret field included - reaches no store at all.
  useEffect(() => {
    writePersistedState(kubernetesDraftKey(), persistedKubernetesDraft(draft))
  }, [draft])

  const hasSecret = SECRET_KUBERNETES_KEYS.some((key) => (draft[key] ?? '').trim() !== '')

  // Still worth a button even though nothing is stored: the values are on screen and in the
  // rendered output until something removes them, and "I am about to share this screen" is the
  // common case. It is named for the category rather than for today's single field - it clears
  // every SECRET_KUBERNETES_KEYS entry, so a second secret field is covered without a rename.
  function clearSecrets() {
    setDraft((prev) => {
      const next = { ...prev }
      for (const key of SECRET_KUBERNETES_KEYS) next[key] = ''
      return next
    })
    setCleared(true)
    setCopied(false)
  }

  const result = renderManifests(draft)
  // What the namespace would be with the override blank, shown so the default is visible rather
  // than something you discover by clearing the field.
  // Note the empty parts are spelled out rather than left blank: with both fields empty,
  // namespaceFor returns "-", which shown on its own reads as a bug rather than as a template.
  const derivedNamespace =
    draft.tenant.trim() && draft.product.trim()
      ? namespaceFor({ ...draft, namespace: '' })
      : `${draft.tenant.trim() || '<tenant>'}-${draft.product.trim() || '<product>'}`

  function setField(key: string, value: unknown) {
    setDraft((prev) => ({ ...prev, [key]: String(value ?? '') }))
    setCopied(false)
    setCleared(false)
  }

  function handleCopy() {
    if (!result.success) return
    void navigator.clipboard.writeText(result.yaml)
    setCopied(true)
  }

  return (
    <div className="workspace">
      <div className="panel workspace-left">
        <section className="card">
          <h2>Namespace inputs</h2>
          <p className="card-note">
            Every resource on the right is named from the namespace, which is{' '}
            <code>{derivedNamespace}</code> unless you give one. Tenant and product are still
            required either way — they label the Namespace object, and the namespace field only
            renames it. Fill them in on the Onboarding checklist and hit “Seed config drafts” to
            have them arrive here already filled.
          </p>
        </section>

        {KUBERNETES_FIELDS.map((field) => (
          <section className="card-flat" key={field.key}>
            <FieldRow field={field} value={draft[field.key] ?? ''} onChange={(value) => setField(field.key, value)} />
            {field.key === 'namespace' && (
              <p className="card-note">
                Optional. Blank uses <code>{derivedNamespace}</code>. Give one to match a cluster
                that already names namespaces its own way.
              </p>
            )}
            {field.type === 'text' && field.secret && (
              <p className="card-note">
                <strong>Never saved.</strong> It is held on this page only — reloading, leaving, or
                switching to another pill clears it and you will need to paste it again. Copy the
                output before you go. Leave it blank to omit the Secret entirely.
              </p>
            )}
          </section>
        ))}

        <section className="card-flat">
          <button type="button" disabled={!hasSecret} onClick={clearSecrets}>
            Clear secrets
          </button>
          <p className="card-note" aria-live="polite">
            {cleared ? 'Cleared from the page.' : 'Removes it from the field and from the output below.'}
          </p>
        </section>

        {result.success && (
          <section className="card">
            <h2>What this renders</h2>
            <ul className="resource-list">
              <li>
                Namespace <code>{result.namespace}</code>
              </li>
              <li>2 ServiceAccounts, with a token Secret each</li>
              <li>1 Role and 1 RoleBinding covering both</li>
              {hasSecret && (
                <li>
                  1 Opaque Secret <code>{result.namespace}-api</code> — <strong>do not commit it</strong>
                </li>
              )}
            </ul>
          </section>
        )}
      </div>

      <div className="panel workspace-right">
        <section className="yaml-panel">
          <div className="yaml-panel-header">
            <h2>Resources</h2>
          </div>

          <p className="placeholder-warning">
            <strong>Placeholder.</strong> The shape is right, but the RBAC rules, the service
            account names and the token Secrets are guesses — every one is marked{' '}
            <code># TODO: confirm</code> in the output. Confirm them before applying this to a
            real cluster.
          </p>

          <Suspense
            fallback={
              <textarea
                className="yaml-editor-fallback"
                aria-label="Rendered Kubernetes manifests"
                readOnly
                value={result.success ? result.yaml : ''}
              />
            }
          >
            <YamlEditor
              label="Rendered Kubernetes manifests"
              value={result.success ? result.yaml : ''}
              onChange={() => {}}
              readOnly
              placeholder="Enter a tenant and a product to render the resources"
            />
          </Suspense>

          <div className="yaml-status" aria-live="polite">
            {result.success ? (
              <p className="success">✓ {copied ? 'Copied — apply with kubectl apply -f -' : 'Rendered'}</p>
            ) : (
              <ul className="errors">
                {result.issues.map((issue, i) => (
                  <li key={i}>{issue}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="yaml-panel-footer">
            <button type="button" disabled={!result.success} onClick={handleCopy}>
              Copy all
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
