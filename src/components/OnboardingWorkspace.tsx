import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { CONFIG_DEFINITIONS } from '../configs'
import { fetchFileContent } from '../lib/github'
import { usePersistedState } from '../lib/persisted-state'
import { dataToYaml, parseYaml, yamlIssueMessages } from '../lib/yaml'
import { checklistKey, checklistSchema, emptyChecklist, type ChecklistState, type OnboardingDefinition } from '../onboarding'
import { doneCount, isDone, normalizeChecklist, toggleStep } from '../onboarding/checklist'
import { DEFAULT_JIRA_BASE_URL } from '../onboarding/jira'
import { describeSeedResults, seedConfigDrafts } from '../onboarding/seed'
import { GithubPushLinks } from './GithubPushLinks'
import { GithubTargetCard } from './GithubTargetCard'
import { OnboardingStep } from './OnboardingStep'
import { useGithubTarget } from './useGithubTarget'

const YamlEditor = lazy(() => import('./YamlEditor'))

type Feedback = { kind: 'valid' } | { kind: 'invalid'; messages: string[] }

// Unlike ConfigWorkspace's deriveFromDraft, this can't fail: nothing in checklistSchema is
// required, so there is always text to show. That's deliberate - blanking the panel until a
// tenant is typed is right for a file you're about to commit, wrong for save/restore state you
// want to start ticking into immediately. Errors here only ever come from malformed *pasted*
// YAML, via handleYamlTextChange below.
function deriveFromChecklist(definition: OnboardingDefinition, state: ChecklistState): string {
  return dataToYaml(normalizeChecklist(definition, state))
}

interface OnboardingWorkspaceProps {
  definition: OnboardingDefinition
  onOpenConfig: (configId: string) => void
  onSeeded: () => void
}

export function OnboardingWorkspace({ definition, onOpenConfig, onSeeded }: OnboardingWorkspaceProps) {
  const [state, setState] = usePersistedState<ChecklistState>(checklistKey(definition), () => emptyChecklist())
  // Not in the checklist YAML: this is a per-user setting, not part of a tenant's onboarding
  // record, and keeping it out means the one value that reaches an href can only ever be typed.
  const [jiraBaseUrl, setJiraBaseUrl] = usePersistedState('jira-base-url', '')

  const target = useGithubTarget(definition.defaultFilename)

  const [yamlText, setYamlText] = useState(() => deriveFromChecklist(definition, state))
  const [feedback, setFeedback] = useState<Feedback>({ kind: 'valid' })
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [seedMessages, setSeedMessages] = useState<string[] | null>(null)
  // Deliberately duplicated from ConfigWorkspace rather than shared: see the comment there. The
  // two panels' derive steps genuinely differ (that one can fail, this one can't), and a shared
  // hook would mean editing the most heavily tested file in the repo for no user-visible gain.
  const editorFocusedRef = useRef(false)

  useEffect(() => {
    if (editorFocusedRef.current) return
    setYamlText(deriveFromChecklist(definition, state))
    setFeedback({ kind: 'valid' })
  }, [definition, state])

  const configLabels = Object.fromEntries(CONFIG_DEFINITIONS.map((d) => [d.id, d.label]))
  const done = doneCount(definition, state)
  const canSeed = Boolean(state.tenant.trim() || state.product.trim())

  // Text -> checklist. Only a successful parse updates the state; malformed text is shown as
  // errors and the checklist is left exactly as it was.
  function handleYamlTextChange(text: string) {
    const parsed = parseYaml(checklistSchema, text)
    if (!parsed.success) {
      setYamlText(text)
      setFeedback({ kind: 'invalid', messages: yamlIssueMessages(parsed) })
      return
    }
    setState(normalizeChecklist(definition, parsed.data))
    setYamlText(text)
    setFeedback({ kind: 'valid' })
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

  function handleSeed() {
    const results = seedConfigDrafts({ tenant: state.tenant, product: state.product })
    setSeedMessages(describeSeedResults(results))
    // App re-reads every pill's status dot on render, but it can't observe a localStorage write
    // made from here - without this the receipt would contradict the dots right next to it.
    onSeeded()
  }

  return (
    <div className="workspace">
      <div className="panel workspace-left">
        <GithubTargetCard target={target} />

        <section className="card">
          <h2>Your details</h2>
          <div className="field-row">
            <label htmlFor="onboarding-tenant">Tenant</label>
            <input
              id="onboarding-tenant"
              value={state.tenant}
              /* Mirrors tenant-config's own maxLength. Seeding can't check length itself (a
                 FieldDescriptor carries no bounds for a plain text field), so the honest place
                 to stop an over-long tenant is where it's typed. */
              maxLength={12}
              placeholder="acme"
              onChange={(e) => setState((prev) => ({ ...prev, tenant: e.target.value }))}
            />
          </div>
          <div className="field-row">
            <label htmlFor="onboarding-product">Product</label>
            <input
              id="onboarding-product"
              value={state.product}
              placeholder="product name"
              onChange={(e) => setState((prev) => ({ ...prev, product: e.target.value }))}
            />
          </div>
          <div className="field-row">
            <label htmlFor="onboarding-jira">Jira base URL</label>
            <input
              id="onboarding-jira"
              value={jiraBaseUrl}
              placeholder={DEFAULT_JIRA_BASE_URL}
              onChange={(e) => setJiraBaseUrl(e.target.value)}
            />
            <p className="github-hint">Set this to turn the ticket keys below into links.</p>
          </div>

          <button type="button" disabled={!canSeed} onClick={handleSeed}>
            Seed config drafts
          </button>
          <div className="seed-result" aria-live="polite">
            {seedMessages?.map((message, i) => (
              <p key={i}>{message}</p>
            ))}
          </div>
        </section>

        <section className="card">
          <h2>Steps</h2>
          {definition.intro && <p className="checklist-intro">{definition.intro}</p>}
          <p className="checklist-progress">
            {done} of {definition.steps.length} done
          </p>
          <ol className="checklist">
            {definition.steps.map((step) => (
              <OnboardingStep
                key={step.id}
                step={step}
                done={isDone(state, step.id)}
                onToggle={(next) => setState((prev) => toggleStep(definition, prev, step.id, next))}
                jiraBaseUrl={jiraBaseUrl}
                configLabels={configLabels}
                onOpenConfig={onOpenConfig}
              />
            ))}
          </ol>
        </section>
      </div>

      <div className="panel workspace-right">
        <section className="yaml-panel">
          <div className="yaml-panel-header">
            <h2>Checklist</h2>
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
            {feedback.kind === 'valid' && <p className="success">✓ Valid — synced to checklist</p>}
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
            <button
              type="button"
              disabled={!target.canFetch || feedback.kind !== 'valid' || target.checkState === 'checking'}
              onClick={target.runCheck}
            >
              {target.checkState === 'checking' ? 'Checking...' : 'Push to GitHub'}
            </button>
          </div>

          <GithubPushLinks state={target.checkState} location={target.location} content={yamlText} />
        </section>
      </div>
    </div>
  )
}
