import { lazy, Suspense, useState } from 'react'
import { usePersistedState } from '../lib/persisted-state'
import {
  emptyKubernetesDraft,
  KUBERNETES_FIELDS,
  kubernetesDraftKey,
  renderManifests,
  type KubernetesDraft,
} from '../kubernetes'
import { FieldRow } from './fields/FieldRow'

const YamlEditor = lazy(() => import('./YamlEditor'))

// Unlike ConfigWorkspace this is one-way: the manifests are rendered from the two inputs and
// there is nothing to sync back. Editing the output would be editing a template's result, so
// the field is read-only and there's no draft-from-YAML path at all - you copy it and apply it.
export function KubernetesWorkspace() {
  const [draft, setDraft] = usePersistedState<KubernetesDraft>(kubernetesDraftKey(), emptyKubernetesDraft)
  const [copied, setCopied] = useState(false)

  const result = renderManifests(draft)

  function setField(key: string, value: unknown) {
    setDraft((prev) => ({ ...prev, [key]: String(value ?? '') }))
    setCopied(false)
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
            Every resource on the right is named from these two values. Fill them in on the
            Onboarding checklist and hit “Seed config drafts” to have them arrive here already
            filled.
          </p>
        </section>

        {KUBERNETES_FIELDS.map((field) => (
          <section className="card-flat" key={field.key}>
            <FieldRow field={field} value={draft[field.key as keyof KubernetesDraft]} onChange={(value) => setField(field.key, value)} />
          </section>
        ))}

        {result.success && (
          <section className="card">
            <h2>What this renders</h2>
            <ul className="resource-list">
              <li>
                Namespace <code>{result.namespace}</code>
              </li>
              <li>2 ServiceAccounts, with a token Secret each</li>
              <li>1 Role and 1 RoleBinding covering both</li>
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

          <Suspense fallback={<textarea className="yaml-editor-fallback" readOnly value={result.success ? result.yaml : ''} />}>
            <YamlEditor
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
