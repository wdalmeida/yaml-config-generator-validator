import { useMemo, useState } from 'react'
import { EXISTING_TENANTS } from '../data/tenants'
import { TOPIC_METHODS, configSchema, type TopicMethod } from '../schema/config'
import { buildCreateFileUrl, buildEditFileUrl, checkFileExists, type FileExistsResult } from '../lib/github'
import { configToYaml } from '../lib/yaml'

interface TopicDraft {
  method: TopicMethod
  name: string
  description: string
}

const emptyTopic: TopicDraft = { method: TOPIC_METHODS[0], name: '', description: '' }

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

  async function handleCheck() {
    if (!canCheck) return
    setCheckState('checking')
    setCheckedKey(locationKey)
    const status = await checkFileExists(location)
    setCheckState(status)
  }

  return (
    <div className="panel">
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
        <div className="github-row">
          <input value={owner} placeholder="owner" onChange={(e) => setOwner(e.target.value)} />
          <input value={repo} placeholder="repo" onChange={(e) => setRepo(e.target.value)} />
          <input value={branch} placeholder="branch" onChange={(e) => setBranch(e.target.value)} />
          <input value={path} placeholder="path/to/config.yaml" onChange={(e) => setPath(e.target.value)} />
        </div>
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
            This file already exists on that branch. GitHub can't prefill an update, so copy the
            YAML above, then paste it into the editor that opens, replacing the current contents,
            and commit.
            <br />
            <a className="github-link" href={buildEditFileUrl(location)} target="_blank" rel="noreferrer">
              Open file on GitHub to update
            </a>
          </p>
        )}

        {effectiveCheckState === 'unknown' && (
          <p className="github-hint">
            Couldn't confirm whether this file exists (private repo, or GitHub's API is
            rate-limited). Use Create if it's new, or Update if it already exists.
            <br />
            <a
              className="github-link"
              href={buildCreateFileUrl({ ...location, content: yaml })}
              target="_blank"
              rel="noreferrer"
            >
              Create file on GitHub
            </a>{' '}
            <a className="github-link" href={buildEditFileUrl(location)} target="_blank" rel="noreferrer">
              Open file on GitHub to update
            </a>
          </p>
        )}
      </section>
    </div>
  )
}
