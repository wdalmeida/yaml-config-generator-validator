import { useMemo, useState } from 'react'
import { EXISTING_TENANTS } from '../data/tenants'
import { TOPIC_METHODS, configSchema, type Config, type TopicMethod } from '../schema/config'
import {
  buildCreateFileUrl,
  buildEditFileUrl,
  checkFileExists,
  fetchFileContent,
  type FileExistsResult,
} from '../lib/github'
import { configToYaml, parseYamlConfig } from '../lib/yaml'

interface TopicDraft {
  method: TopicMethod
  name: string
  description: string
}

const emptyTopic: TopicDraft = { method: TOPIC_METHODS[0], name: '', description: '' }

type LoadState = { kind: 'idle' } | { kind: 'loading' } | { kind: 'error'; message: string }

export function GeneratorForm() {
  const [tenantMode, setTenantMode] = useState<'existing' | 'new'>(
    EXISTING_TENANTS.length > 0 ? 'existing' : 'new',
  )
  const [tenantExisting, setTenantExisting] = useState<string>(EXISTING_TENANTS[0] ?? '')
  const [tenantNew, setTenantNew] = useState('')
  const [product, setProduct] = useState('')
  const [proxyEntries, setProxyEntries] = useState<string[]>([''])
  const [topics, setTopics] = useState<TopicDraft[]>([{ ...emptyTopic }])

  const [owner, setOwner] = useState('')
  const [repo, setRepo] = useState('')
  const [branch, setBranch] = useState('main')
  const [path, setPath] = useState('config.yaml')
  const [checkState, setCheckState] = useState<'idle' | 'checking' | FileExistsResult>('idle')
  // The location a check was last run for. Once the target fields change, the check is stale
  // and we fall back to 'idle' during render rather than syncing state via an effect.
  const [checkedKey, setCheckedKey] = useState<string | null>(null)

  const [pastedYaml, setPastedYaml] = useState('')
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'idle' })

  const tenant = tenantMode === 'existing' ? tenantExisting : tenantNew

  const result = useMemo(
    () =>
      configSchema.safeParse({
        tenant,
        product,
        proxyEntries: proxyEntries.filter((entry) => entry.trim().length > 0),
        githubTopics: topics
          .filter((topic) => topic.name.trim().length > 0 || topic.description.trim().length > 0)
          .map((topic) => ({ ...topic })),
      }),
    [tenant, product, proxyEntries, topics],
  )

  const yaml = result.success ? configToYaml(result.data) : ''
  const canCheck = result.success && Boolean(owner.trim() && repo.trim() && path.trim())
  const location = { owner: owner.trim(), repo: repo.trim(), branch: branch.trim() || 'main', path: path.trim() }
  const locationKey = `${location.owner}|${location.repo}|${location.branch}|${location.path}`
  const effectiveCheckState = checkedKey === locationKey ? checkState : 'idle'

  // Populates every field from a parsed config, e.g. after loading an existing file.
  function applyConfig(config: Config) {
    if ((EXISTING_TENANTS as readonly string[]).includes(config.tenant)) {
      setTenantMode('existing')
      setTenantExisting(config.tenant)
    } else {
      setTenantMode('new')
      setTenantNew(config.tenant)
    }
    setProduct(config.product)
    setProxyEntries(config.proxyEntries.length > 0 ? config.proxyEntries : [''])
    setTopics(config.githubTopics.length > 0 ? config.githubTopics.map((t) => ({ ...t })) : [{ ...emptyTopic }])
    setLoadState({ kind: 'idle' })
  }

  async function handleLoadFromGithub() {
    if (!owner.trim() || !repo.trim() || !path.trim()) return
    setLoadState({ kind: 'loading' })
    const fileResult = await fetchFileContent(location)
    if (!fileResult.success) {
      setLoadState({
        kind: 'error',
        message: "Couldn't fetch that file (private repo, wrong path, or not found). Try pasting its contents instead.",
      })
      return
    }
    const parsed = parseYamlConfig(fileResult.content)
    if (!parsed.success) {
      setLoadState({
        kind: 'error',
        message: 'yamlError' in parsed ? `Fetched file has invalid YAML: ${parsed.yamlError}` : "Fetched file doesn't match the config schema.",
      })
      return
    }
    applyConfig(parsed.data)
  }

  function handleLoadFromPaste() {
    const parsed = parseYamlConfig(pastedYaml)
    if (!parsed.success) {
      setLoadState({
        kind: 'error',
        message: 'yamlError' in parsed ? `Invalid YAML: ${parsed.yamlError}` : "That YAML doesn't match the config schema.",
      })
      return
    }
    applyConfig(parsed.data)
    setPastedYaml('')
  }

  async function handleCheck() {
    if (!canCheck) return
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
    <div className="panel">
      <section>
        <h2>Target file on GitHub</h2>
        <div className="github-row">
          <input value={owner} placeholder="owner" onChange={(e) => setOwner(e.target.value)} />
          <input value={repo} placeholder="repo" onChange={(e) => setRepo(e.target.value)} />
          <input value={branch} placeholder="branch" onChange={(e) => setBranch(e.target.value)} />
          <input value={path} placeholder="path/to/config.yaml" onChange={(e) => setPath(e.target.value)} />
        </div>
      </section>

      <section>
        <h2>Load existing config (optional)</h2>
        <p className="github-hint">
          Editing a config that's already committed? Load it here first, either straight from
          GitHub or by pasting its contents, and the fields below will be filled in for you.
        </p>
        <button
          type="button"
          disabled={!owner.trim() || !repo.trim() || !path.trim() || loadState.kind === 'loading'}
          onClick={handleLoadFromGithub}
        >
          {loadState.kind === 'loading' ? 'Loading...' : 'Load from GitHub'}
        </button>

        <div className="paste-row">
          <textarea
            className="yaml-input"
            rows={4}
            value={pastedYaml}
            placeholder="...or paste the existing YAML content here"
            onChange={(e) => setPastedYaml(e.target.value)}
          />
        </div>
        <button type="button" disabled={!pastedYaml.trim()} onClick={handleLoadFromPaste}>
          Load pasted YAML
        </button>

        {loadState.kind === 'error' && <p className="error">{loadState.message}</p>}
      </section>

      <section>
        <h2>Tenant</h2>
        <div className="radio-row">
          <label>
            <input
              type="radio"
              checked={tenantMode === 'existing'}
              disabled={!EXISTING_TENANTS.length}
              onChange={() => setTenantMode('existing')}
            />
            Existing tenant
          </label>
          <label>
            <input type="radio" checked={tenantMode === 'new'} onChange={() => setTenantMode('new')} />
            New tenant
          </label>
        </div>
        {tenantMode === 'existing' ? (
          <select value={tenantExisting} onChange={(e) => setTenantExisting(e.target.value)}>
            {EXISTING_TENANTS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        ) : (
          <input
            value={tenantNew}
            maxLength={12}
            placeholder="new-tenant"
            onChange={(e) => setTenantNew(e.target.value)}
          />
        )}
      </section>

      <section>
        <h2>Product</h2>
        <input value={product} placeholder="product name" onChange={(e) => setProduct(e.target.value)} />
      </section>

      <section>
        <h2>Proxy entries</h2>
        {proxyEntries.map((entry, index) => (
          <div className="list-row" key={index}>
            <input
              value={entry}
              placeholder="*.github.com"
              onChange={(e) =>
                setProxyEntries((prev) => prev.map((v, i) => (i === index ? e.target.value : v)))
              }
            />
            <button
              type="button"
              onClick={() => setProxyEntries((prev) => prev.filter((_, i) => i !== index))}
              disabled={proxyEntries.length === 1}
            >
              Remove
            </button>
          </div>
        ))}
        <button type="button" onClick={() => setProxyEntries((prev) => [...prev, ''])}>
          Add proxy entry
        </button>
      </section>

      <section>
        <h2>GitHub topics</h2>
        {topics.map((topic, index) => (
          <div className="topic-row" key={index}>
            <select
              value={topic.method}
              onChange={(e) =>
                setTopics((prev) =>
                  prev.map((t, i) => (i === index ? { ...t, method: e.target.value as TopicMethod } : t)),
                )
              }
            >
              {TOPIC_METHODS.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>
            <input
              value={topic.name}
              placeholder="name"
              onChange={(e) =>
                setTopics((prev) => prev.map((t, i) => (i === index ? { ...t, name: e.target.value } : t)))
              }
            />
            <input
              value={topic.description}
              placeholder="description"
              onChange={(e) =>
                setTopics((prev) =>
                  prev.map((t, i) => (i === index ? { ...t, description: e.target.value } : t)),
                )
              }
            />
            <button
              type="button"
              onClick={() => setTopics((prev) => prev.filter((_, i) => i !== index))}
              disabled={topics.length === 1}
            >
              Remove
            </button>
          </div>
        ))}
        <button type="button" onClick={() => setTopics((prev) => [...prev, { ...emptyTopic }])}>
          Add topic
        </button>
      </section>

      <section>
        <h2>Output</h2>
        {!result.success && (
          <ul className="errors">
            {result.error.issues.map((issue, i) => (
              <li key={i}>
                {issue.path.join('.') || '(root)'}: {issue.message}
              </li>
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
        <button type="button" disabled={!canCheck || effectiveCheckState === 'checking'} onClick={handleCheck}>
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
            This file already exists on that branch. GitHub can't prefill an update, so the YAML
            has been copied to your clipboard — in the editor that opens, select all (Cmd/Ctrl+A),
            paste (Cmd/Ctrl+V) to replace the contents, then commit.
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
            rate-limited). Use Create if it's new, or Update if it already exists — Update copies
            the YAML to your clipboard first, since GitHub can't prefill an edit.
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
  )
}
