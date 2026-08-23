import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { ConfigDefinition } from '../configs'
import { draftFromCandidate, emptyDraftFor, parseDraft } from '../configs'
import {
  buildCreateFileUrl,
  buildEditFileUrl,
  checkFileExists,
  fetchFileContent,
  type FileExistsResult,
} from '../lib/github'
import { dataToYaml, parseYaml } from '../lib/yaml'
import { usePersistedState } from '../lib/persisted-state'
import { FieldRow } from './fields/FieldRow'

const YamlEditor = lazy(() => import('./YamlEditor'))

// Feedback for the unified YAML field: whether the text currently shown is valid (and therefore
// in sync with the form) or not (and therefore left the form untouched at its last-known-good
// state). Independent of the separate Fetch-from-GitHub loading/error state below.
type Feedback = { kind: 'valid' } | { kind: 'invalid'; messages: string[] }

function issuesFor(parsed: ReturnType<typeof parseYaml>): string[] {
  if (parsed.success) return []
  return 'yamlError' in parsed ? [`YAML syntax error: ${parsed.yamlError}`] : parsed.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
}

function deriveFromDraft(definition: ConfigDefinition, draft: Record<string, unknown>): { yamlText: string; feedback: Feedback } {
  const result = parseDraft(definition, draft)
  if (result.success) return { yamlText: dataToYaml(result.data), feedback: { kind: 'valid' } }
  return { yamlText: '', feedback: { kind: 'invalid', messages: result.issues } }
}

export function ConfigWorkspace({ definition }: { definition: ConfigDefinition }) {
  const [draft, setDraft] = usePersistedState<Record<string, unknown>>(`draft:${definition.id}`, () =>
    emptyDraftFor(definition),
  )

  // owner/repo/branch are shared across config types (same target repo); path defaults to
  // this type's conventional filename but is remembered per type once the user changes it.
  const [owner, setOwner] = usePersistedState('github-owner', '')
  const [repo, setRepo] = usePersistedState('github-repo', '')
  const [branch, setBranch] = usePersistedState('github-branch', 'main')
  const [path, setPath] = usePersistedState(`github-path:${definition.id}`, definition.defaultFilename)

  const [checkState, setCheckState] = useState<'idle' | 'checking' | FileExistsResult>('idle')
  // The location a check was last run for. Once the target fields change, the check is stale
  // and we fall back to 'idle' during render rather than syncing state via an effect.
  const [checkedKey, setCheckedKey] = useState<string | null>(null)

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

  const canFetch = Boolean(owner.trim() && repo.trim() && path.trim())
  const canPush = feedback.kind === 'valid' && canFetch
  const location = { owner: owner.trim(), repo: repo.trim(), branch: branch.trim() || 'main', path: path.trim() }
  const locationKey = `${location.owner}|${location.repo}|${location.branch}|${location.path}`
  const effectiveCheckState = checkedKey === locationKey ? checkState : 'idle'

  function setField(key: string, value: unknown) {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  // Text -> form: the editor's onChange, and Fetch from GitHub. Only a successful parse updates
  // the draft - invalid text is shown as errors and the form is left exactly as it was.
  function handleYamlTextChange(text: string) {
    const parsed = parseYaml(definition.schema, text)
    if (!parsed.success) {
      setYamlState({ yamlText: text, feedback: { kind: 'invalid', messages: issuesFor(parsed) } })
      return
    }
    setDraft(draftFromCandidate(definition.fields, parsed.data as Record<string, unknown>))
    setYamlState({ yamlText: text, feedback: { kind: 'valid' } })
  }

  async function handleFetchFromGithub() {
    if (!canFetch) return
    setFetching(true)
    setFetchError(null)
    const fileResult = await fetchFileContent(location)
    setFetching(false)
    if (!fileResult.success) {
      setFetchError("Couldn't fetch that file (private repo, wrong path, or not found). Try pasting its contents instead.")
      return
    }
    handleYamlTextChange(fileResult.content)
  }

  async function handleCheck() {
    if (!canPush) return
    setCheckState('checking')
    setCheckedKey(locationKey)
    const status = await checkFileExists(location)
    setCheckState(status)
  }

  // Copies the YAML before GitHub's editor opens in the new tab, so the user only has to
  // select-all and paste there instead of also going back to hit "Copy YAML" first.
  function handleOpenToUpdate() {
    void navigator.clipboard.writeText(yamlText)
  }

  return (
    <div className="workspace">
      <div className="panel workspace-left">
        <section className="card">
          <h2>Target file on GitHub</h2>
          <div className="github-row">
            <input value={owner} placeholder="owner" onChange={(e) => setOwner(e.target.value)} />
            <input value={repo} placeholder="repo" onChange={(e) => setRepo(e.target.value)} />
            <input value={branch} placeholder="branch" onChange={(e) => setBranch(e.target.value)} />
            <input value={path} placeholder="path/to/file.yaml" onChange={(e) => setPath(e.target.value)} />
          </div>
        </section>

        {definition.fields.map((field) => (
          <section className="card-flat" key={field.key}>
            <FieldRow field={field} value={draft[field.key]} onChange={(value) => setField(field.key, value)} />
          </section>
        ))}

        <section className="card">
          <h2>Push to GitHub</h2>
          <button type="button" disabled={!canPush || effectiveCheckState === 'checking'} onClick={handleCheck}>
            {effectiveCheckState === 'checking' ? 'Checking...' : 'Get GitHub link'}
          </button>

          {effectiveCheckState === 'missing' && (
            <p className="github-hint">
              <a
                className="github-link primary"
                href={buildCreateFileUrl({ ...location, content: yamlText })}
                target="_blank"
                rel="noreferrer"
              >
                Create file on GitHub
              </a>
            </p>
          )}

          {effectiveCheckState === 'exists' && (
            <p className="github-hint">
              This file already exists on that branch. GitHub can't prefill an update, so the
              YAML has been copied to your clipboard — in the editor that opens, select all
              (Cmd/Ctrl+A), paste (Cmd/Ctrl+V) to replace the contents, then commit.
              <br />
              <a className="github-link primary" href={buildEditFileUrl(location)} target="_blank" rel="noreferrer" onClick={handleOpenToUpdate}>
                Open file on GitHub to update
              </a>
            </p>
          )}

          {effectiveCheckState === 'unknown' && (
            <p className="github-hint">
              Couldn't confirm whether this file exists (private repo, or GitHub's API is
              rate-limited). Use Create if it's new, or Update if it already exists — Update
              copies the YAML to your clipboard first, since GitHub can't prefill an edit.
              <br />
              <a
                className="github-link primary"
                href={buildCreateFileUrl({ ...location, content: yamlText })}
                target="_blank"
                rel="noreferrer"
              >
                Create file on GitHub
              </a>{' '}
              <a className="github-link" href={buildEditFileUrl(location)} target="_blank" rel="noreferrer" onClick={handleOpenToUpdate}>
                Open file on GitHub to update
              </a>
            </p>
          )}
        </section>
      </div>

      <div className="panel workspace-right">
        <section className="yaml-panel">
          <div className="yaml-panel-header">
            <h2>YAML</h2>
            <button type="button" disabled={!canFetch || fetching} onClick={handleFetchFromGithub}>
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

          <button type="button" disabled={feedback.kind !== 'valid'} onClick={() => navigator.clipboard.writeText(yamlText)}>
            Copy YAML
          </button>
        </section>
      </div>
    </div>
  )
}
