import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { ConfigDefinition } from '../configs'
import { draftFromCandidate, emptyDraftFor, parseDraft } from '../configs'
import { fetchFileContent } from '../lib/github'
import { dataToYaml, parseYaml, yamlIssueMessages } from '../lib/yaml'
import { usePersistedState } from '../lib/persisted-state'
import { FieldRow } from './fields/FieldRow'
import { GithubPushLinks } from './GithubPushLinks'
import { GithubTargetCard } from './GithubTargetCard'
import { useGithubTarget } from './useGithubTarget'

const YamlEditor = lazy(() => import('./YamlEditor'))

// Feedback for the unified YAML field: whether the text currently shown is valid (and therefore
// in sync with the form) or not (and therefore left the form untouched at its last-known-good
// state). Independent of the separate Fetch-from-GitHub loading/error state below.
type Feedback = { kind: 'valid' } | { kind: 'invalid'; messages: string[] }

function deriveFromDraft(definition: ConfigDefinition, draft: Record<string, unknown>): { yamlText: string; feedback: Feedback } {
  const result = parseDraft(definition, draft)
  if (result.success) return { yamlText: dataToYaml(result.data), feedback: { kind: 'valid' } }
  return { yamlText: '', feedback: { kind: 'invalid', messages: result.issues } }
}

export function ConfigWorkspace({ definition }: { definition: ConfigDefinition }) {
  const [draft, setDraft] = usePersistedState<Record<string, unknown>>(`draft:${definition.id}`, () =>
    emptyDraftFor(definition),
  )

  // Not editable and not persisted: our software looks for each config under one fixed name,
  // so letting anyone retarget it only produces a file the software never reads.
  const target = useGithubTarget(definition.defaultFilename)

  const [{ yamlText, feedback }, setYamlState] = useState(() => deriveFromDraft(definition, draft))
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  // Not React state: the browser can only focus one control at a time, so while the editor is
  // focused a FieldRow's onChange can't fire - this just stops the effect below from clobbering
  // the user's in-progress typing by re-deriving text from a draft that hasn't changed yet.
  const editorFocusedRef = useRef(false)

  // Form -> text: re-derive the field's content and validity from the draft on every change,
  // unless the user is actively typing directly into the field (handleYamlTextChange below
  // already updated both in that case).
  useEffect(() => {
    if (editorFocusedRef.current) return
    setYamlState(deriveFromDraft(definition, draft))
  }, [definition, draft])

  const canPush = feedback.kind === 'valid' && target.canFetch

  function setField(key: string, value: unknown) {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  // Text -> form: the editor's onChange, and Fetch from GitHub. Only a successful parse updates
  // the draft - invalid text is shown as errors and the form is left exactly as it was.
  function handleYamlTextChange(text: string) {
    const parsed = parseYaml(definition.schema, text)
    if (!parsed.success) {
      setYamlState({ yamlText: text, feedback: { kind: 'invalid', messages: yamlIssueMessages(parsed) } })
      return
    }
    setDraft(draftFromCandidate(definition.fields, parsed.data as Record<string, unknown>))
    setYamlState({ yamlText: text, feedback: { kind: 'valid' } })
  }

  async function handleFetchFromGithub() {
    if (!target.canFetch) return
    setFetching(true)
    setFetchError(null)
    const fileResult = await fetchFileContent(target.location)
    setFetching(false)
    if (!fileResult.success) {
      setFetchError("Couldn't fetch that file (private repo, wrong path, or not found). Try pasting its contents instead.")
      return
    }
    handleYamlTextChange(fileResult.content)
  }

  return (
    <div className="workspace">
      <div className="panel workspace-left">
        <GithubTargetCard target={target} />

        {definition.fields.map((field) => (
          <section className="card-flat" key={field.key}>
            <FieldRow field={field} value={draft[field.key]} onChange={(value) => setField(field.key, value)} />
          </section>
        ))}
      </div>

      <div className="panel workspace-right">
        <section className="yaml-panel">
          <div className="yaml-panel-header">
            <h2>YAML</h2>
            <button type="button" disabled={!target.canFetch || fetching} onClick={handleFetchFromGithub}>
              {fetching ? 'Fetching...' : 'Fetch from GitHub'}
            </button>
          </div>

          <Suspense fallback={<textarea className="yaml-editor-fallback" readOnly value={yamlText} />}>
            <YamlEditor
              value={yamlText}
              onChange={handleYamlTextChange}
              onFocus={() => {
                editorFocusedRef.current = true
              }}
              onBlur={() => {
                editorFocusedRef.current = false
              }}
              placeholder={`Paste, edit, or fetch ${definition.defaultFilename} here`}
            />
          </Suspense>

          <div className="yaml-status" aria-live="polite">
            {fetchError && <p className="error">{fetchError}</p>}
            {feedback.kind === 'valid' && <p className="success">✓ Valid — synced to form</p>}
            {feedback.kind === 'invalid' && (
              <ul className="errors">
                {feedback.messages.map((message, i) => (
                  <li key={i}>{message}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="yaml-panel-footer">
            <button type="button" disabled={feedback.kind !== 'valid'} onClick={() => navigator.clipboard.writeText(yamlText)}>
              Copy YAML
            </button>
            <button type="button" disabled={!canPush || target.checkState === 'checking'} onClick={target.runCheck}>
              {target.checkState === 'checking' ? 'Checking...' : 'Push to GitHub'}
            </button>
          </div>

          <GithubPushLinks state={target.checkState} location={target.location} content={yamlText} />
        </section>
      </div>
    </div>
  )
}
