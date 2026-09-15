import { useState } from 'react'
import { CONFIG_DEFINITIONS } from '../configs'
import { KUBERNETES_DEFINITION } from '../kubernetes'
import { usePersistedState } from '../lib/persisted-state'
import { checklistKey, emptyChecklist, type ChecklistState, type OnboardingDefinition, type StepPath } from '../onboarding'
import { doneCount, isDone, toggleStep } from '../onboarding/checklist'
import { DEFAULT_CONSOLE_BASE_URL, DEFAULT_JIRA_BASE_URL } from '../onboarding/links'
import { describeSeedResults, seedConfigDrafts } from '../onboarding/seed'
import { OnboardingStep } from './OnboardingStep'

interface OnboardingWorkspaceProps {
  definition: OnboardingDefinition
  onOpenConfig: (configId: string) => void
  onSeeded: () => void
}

// Deliberately not the two-column .workspace layout the generator pills use. There is no file
// to render here - a step's output is either one of the config pills or the Kubernetes
// resources, each of which has its own pill and its own YAML. So the steps are the page: one
// centred column, nothing competing with them for the reader's attention.
export function OnboardingWorkspace({ definition, onOpenConfig, onSeeded }: OnboardingWorkspaceProps) {
  const [state, setState] = usePersistedState<ChecklistState>(checklistKey(definition), () => emptyChecklist())
  // Per-user, not per-tenant, so these are their own keys rather than part of the checklist
  // state - two people onboarding the same tenant may well use different hosts, and the
  // CLI/UI preference is a property of the person, not of the process.
  const [jiraBaseUrl, setJiraBaseUrl] = usePersistedState('jira-base-url', '')
  const [consoleBaseUrl, setConsoleBaseUrl] = usePersistedState('console-base-url', '')
  const [path, setPath] = usePersistedState<StepPath>('step-path', 'cli')
  const [seedMessages, setSeedMessages] = useState<string[] | null>(null)

  const pillLabels = Object.fromEntries(
    [...CONFIG_DEFINITIONS, KUBERNETES_DEFINITION].map((d) => [d.id, d.label]),
  )
  const done = doneCount(definition, state)
  const canSeed = Boolean(state.tenant.trim() || state.product.trim())

  function handleSeed() {
    setSeedMessages(describeSeedResults(seedConfigDrafts({ tenant: state.tenant, product: state.product })))
    // App re-reads every pill's status dot on render, but it can't observe a localStorage write
    // made from here - without this the receipt would contradict the dots right next to it.
    onSeeded()
  }

  return (
    <div className="onboarding">
      <section className="card onboarding-details">
        <h2>Your details</h2>
        <p className="card-note">
          Typed once here, then pushed into every pill that needs them — the Kubernetes
          resources are named entirely from these two values.
        </p>

        <div className="onboarding-details-row">
          <div className="field-row">
            <label htmlFor="onboarding-tenant">Tenant</label>
            {/* Mirrors tenant-config's own maxLength. Seeding can't check length itself (a
                FieldDescriptor carries no bounds for a plain text field), so the honest place
                to stop an over-long tenant is where it's typed. */}
            <input
              id="onboarding-tenant"
              value={state.tenant}
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
          </div>
          <div className="field-row">
            <label htmlFor="onboarding-console">{definition.consoleLabel} base URL</label>
            <input
              id="onboarding-console"
              value={consoleBaseUrl}
              placeholder={DEFAULT_CONSOLE_BASE_URL}
              onChange={(e) => setConsoleBaseUrl(e.target.value)}
            />
          </div>
        </div>

        <div className="onboarding-actions">
          <button type="button" disabled={!canSeed} onClick={handleSeed}>
            Seed config drafts
          </button>
          <span className="github-hint">Set the base URLs to turn the references below into links.</span>
        </div>

        <div className="seed-result" aria-live="polite">
          {seedMessages?.map((message, i) => (
            <p key={i}>{message}</p>
          ))}
        </div>
      </section>

      <section className="onboarding-steps">
        <div className="checklist-header">
          <h2>Steps</h2>
          <p className="checklist-progress">
            {done} of {definition.steps.length} done
          </p>
        </div>
        {definition.intro && <p className="checklist-intro">{definition.intro}</p>}

        {/* A radiogroup rather than two toggle buttons: these are two views of the same thing,
            exactly one is active, and a fieldset legend gives screen readers what the visual
            segmented control conveys by grouping. */}
        <fieldset className="path-switch">
          <legend>How do you want to do these?</legend>
          <label className={path === 'cli' ? 'active' : undefined}>
            <input type="radio" name="step-path" value="cli" checked={path === 'cli'} onChange={() => setPath('cli')} />
            Command line
          </label>
          <label className={path === 'ui' ? 'active' : undefined}>
            <input type="radio" name="step-path" value="ui" checked={path === 'ui'} onChange={() => setPath('ui')} />
            {definition.consoleLabel}
          </label>
        </fieldset>

        {path === 'ui' && (
          <p className="github-hint">
            {definition.consoleLabel} links open in a new tab. To keep this checklist beside it,
            split your browser window — or just drag the tab out into a second window.
          </p>
        )}

        <ol className="checklist">
          {definition.steps.map((step) => (
            <OnboardingStep
              key={step.id}
              step={step}
              done={isDone(state, step.id)}
              onToggle={(next) => setState((prev) => toggleStep(definition, prev, step.id, next))}
              jiraBaseUrl={jiraBaseUrl}
              consoleBaseUrl={consoleBaseUrl}
              consoleLabel={definition.consoleLabel}
              path={path}
              pillLabels={pillLabels}
              onOpenConfig={onOpenConfig}
            />
          ))}
        </ol>
      </section>
    </div>
  )
}
