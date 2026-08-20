import { useMemo, useState } from 'react'
import type { ConfigDefinition } from '../configs'
import { emptyDraftFor, parseDraft } from '../configs'
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

// Feedback for the left column's paste-and-validate box. One shared result type for all three
// actions that can produce it (fetch from GitHub, Validate, Load into form) so there's a single
// feedback area instead of three independent ones.
type PasteBoxResult =
  | { kind: 'idle' }
  | { kind: 'fetching' }
  | { kind: 'fetch-error'; message: string }
  | { kind: 'valid' }
  | { kind: 'invalid'; messages: string[] }
  | { kind: 'loaded' }

function issuesFor(parsed: ReturnType<typeof parseYaml>): string[] {
  if (parsed.success) return []
  return 'yamlError' in parsed ? [`YAML syntax error: ${parsed.yamlError}`] : parsed.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
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

  const [pastedYaml, setPastedYaml] = useState('')
  const [pasteBoxResult, setPasteBoxResult] = useState<PasteBoxResult>({ kind: 'idle' })

  const result = useMemo(() => parseDraft(definition, draft), [definition, draft])
  const yaml = result.success ? dataToYaml(result.data) : ''
  const canFetch = Boolean(owner.trim() && repo.trim() && path.trim())
  const canPush = result.success && canFetch
  const location = { owner: owner.trim(), repo: repo.trim(), branch: branch.trim() || 'main', path: path.trim() }
  const locationKey = `${location.owner}|${location.repo}|${location.branch}|${location.path}`
  const effectiveCheckState = checkedKey === locationKey ? checkState : 'idle'

  function setField(key: string, value: unknown) {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  async function handleFetchFromGithub() {
    if (!canFetch) return
    setPasteBoxResult({ kind: 'fetching' })
    const fileResult = await fetchFileContent(location)
    if (!fileResult.success) {
      setPasteBoxResult({
        kind: 'fetch-error',
        message: "Couldn't fetch that file (private repo, wrong path, or not found). Try pasting its contents instead.",
      })
      return
    }
    setPastedYaml(fileResult.content)
    setPasteBoxResult({ kind: 'idle' })
  }

  function handleValidate() {
    const parsed = parseYaml(definition.schema, pastedYaml)
    setPasteBoxResult(parsed.success ? { kind: 'valid' } : { kind: 'invalid', messages: issuesFor(parsed) })
  }

  function handleLoadIntoForm() {
    const parsed = parseYaml(definition.schema, pastedYaml)
    if (!parsed.success) {
      setPasteBoxResult({ kind: 'invalid', messages: issuesFor(parsed) })
      return
    }
    setDraft({ ...emptyDraftFor(definition), ...(parsed.data as Record<string, unknown>) })
    setPastedYaml('')
    setPasteBoxResult({ kind: 'loaded' })
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
    void navigator.clipboard.writeText(yaml)
  }

  return (
    <div className="workspace">
      <div className="panel workspace-left">
        <section>
          <h2>Target file on GitHub</h2>
          <div className="github-row">
            <input value={owner} placeholder="owner" onChange={(e) => setOwner(e.target.value)} />
            <input value={repo} placeholder="repo" onChange={(e) => setRepo(e.target.value)} />
            <input value={branch} placeholder="branch" onChange={(e) => setBranch(e.target.value)} />
            <input value={path} placeholder="path/to/file.yaml" onChange={(e) => setPath(e.target.value)} />
          </div>
        </section>

        <section>
          <h2>Load &amp; validate</h2>
          <p className="github-hint">
            Fetch an already-committed file from GitHub, or paste its YAML below, then Validate
            to check it or Load into form to start editing it.
          </p>
          <button type="button" disabled={!canFetch || pasteBoxResult.kind === 'fetching'} onClick={handleFetchFromGithub}>
            {pasteBoxResult.kind === 'fetching' ? 'Fetching...' : 'Fetch from GitHub'}
          </button>

          <div className="paste-row">
            <textarea
              className="yaml-input"
              rows={10}
              value={pastedYaml}
              placeholder={`Paste the contents of ${definition.defaultFilename} here`}
              onChange={(e) => setPastedYaml(e.target.value)}
            />
          </div>
          <div className="list-row">
            <button type="button" disabled={!pastedYaml.trim()} onClick={handleValidate}>
              Validate
            </button>
            <button type="button" disabled={!pastedYaml.trim()} onClick={handleLoadIntoForm}>
              Load into form
            </button>
          </div>

          {pasteBoxResult.kind === 'fetch-error' && <p className="error">{pasteBoxResult.message}</p>}
          {pasteBoxResult.kind === 'valid' && <p className="success">Valid config.</p>}
          {pasteBoxResult.kind === 'loaded' && <p className="success">Loaded into the form.</p>}
          {pasteBoxResult.kind === 'invalid' && (
            <ul className="errors">
              {pasteBoxResult.messages.map((message, i) => (
                <li key={i}>{message}</li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="panel workspace-right">
        {definition.fields.map((field) => (
          <section key={field.key}>
            <FieldRow field={field} value={draft[field.key]} onChange={(value) => setField(field.key, value)} />
          </section>
        ))}

        <section>
          <h2>Output</h2>
          {!result.success && (
            <ul className="errors">
              {result.issues.map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
            </ul>
          )}
          <textarea className="yaml-output" readOnly value={yaml} rows={10} />
          <button type="button" disabled={!yaml} onClick={() => navigator.clipboard.writeText(yaml)}>
            Copy YAML
          </button>
        </section>

        <section>
          <h2>Push to GitHub</h2>
          <button type="button" disabled={!canPush || effectiveCheckState === 'checking'} onClick={handleCheck}>
            {effectiveCheckState === 'checking' ? 'Checking...' : 'Get GitHub link'}
          </button>

          {effectiveCheckState === 'missing' && (
            <p className="github-hint">
              <a
                className="github-link"
                href={buildCreateFileUrl({ ...location, content: yaml })}
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
              <a
                className="github-link"
                href={buildEditFileUrl(location)}
                target="_blank"
                rel="noreferrer"
                onClick={handleOpenToUpdate}
              >
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
                className="github-link"
                href={buildCreateFileUrl({ ...location, content: yaml })}
                target="_blank"
                rel="noreferrer"
              >
                Create file on GitHub
              </a>{' '}
              <a
                className="github-link"
                href={buildEditFileUrl(location)}
                target="_blank"
                rel="noreferrer"
                onClick={handleOpenToUpdate}
              >
                Open file on GitHub to update
              </a>
            </p>
          )}
        </section>
      </div>
    </div>
  )
}
