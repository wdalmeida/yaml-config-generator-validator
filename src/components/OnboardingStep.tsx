import { consoleUrlFor, jiraUrlFor } from '../onboarding/links'
import type { OnboardingAction, OnboardingStep as Step, OnboardingPathVariant, StepPath } from '../onboarding'
import { DocsIcon, LinkIcon, TerminalIcon, TicketIcon } from './icons'

interface OnboardingStepProps {
  step: Step
  done: boolean
  onToggle: (done: boolean) => void
  jiraBaseUrl: string
  consoleBaseUrl: string
  consoleLabel: string
  // Which lane of instructions to show. The other one is not rendered at all - that's the whole
  // point of the switch, and a reader who picked "UI" shouldn't have to scroll past commands.
  path: StepPath
  // Label for a `config` action's target pill, keyed by pill id. An action naming a pill
  // that no longer exists renders nothing rather than a dead button - forgiving at runtime
  // so deleting a schema file can't white-screen the app, while lint:schemas fails on it.
  pillLabels: Record<string, string>
  onOpenConfig: (configId: string) => void
}

// Fully controlled, no local state - same contract as FieldRow.
export function OnboardingStep({
  step,
  done,
  onToggle,
  jiraBaseUrl,
  consoleBaseUrl,
  consoleLabel,
  path,
  pillLabels,
  onOpenConfig,
}: OnboardingStepProps) {
  // The switch hides the route you didn't pick - but only when there is actually a choice to
  // make. A step documented just one way shows that one way regardless, tagged so it's obvious
  // why you're looking at commands while the switch says UI. Hiding it instead would leave the
  // step looking like it needs nothing done to it.
  const selected: OnboardingPathVariant | undefined = path === 'cli' ? step.cli : step.ui
  const fallback: OnboardingPathVariant | undefined = path === 'cli' ? step.ui : step.cli
  const variant = selected ?? fallback
  const onlyRoute = !selected && Boolean(fallback)

  // Read off the variant actually being shown, not off `path`: when a CLI reader falls back to
  // a UI-only step, that step's console link is part of what they need.
  const showingUi = Boolean(step.ui) && variant === step.ui
  const consolePath = showingUi ? step.ui?.console : undefined
  const consoleHref = consolePath ? consoleUrlFor(consoleBaseUrl, consolePath) : null

  function renderAction(action: OnboardingAction, index: number) {
    switch (action.type) {
      case 'docs':
        return (
          <a key={index} className="step-link" href={action.url} target="_blank" rel="noreferrer">
            <DocsIcon />
            {action.label ?? 'Docs'}
          </a>
        )

      case 'link':
        return (
          <a key={index} className="step-link" href={action.url} target="_blank" rel="noreferrer">
            <LinkIcon />
            {action.label}
          </a>
        )

      case 'jira': {
        const href = jiraUrlFor(jiraBaseUrl, action.key)
        const label = action.label ?? action.key
        // No usable base URL yet: show the ticket key as plain text, so the reference is still
        // there to copy, rather than linking to a domain nobody here controls.
        if (!href) {
          return (
            <span key={index} className="step-link step-link-inert">
              <TicketIcon />
              Jira {label}
            </span>
          )
        }
        return (
          <a key={index} className="step-link" href={href} target="_blank" rel="noreferrer">
            <TicketIcon />
            Jira {label}
          </a>
        )
      }

      case 'command':
        return (
          <span key={index} className="step-command">
            <TerminalIcon />
            <code>{action.command}</code>
            <button type="button" onClick={() => navigator.clipboard.writeText(action.command)}>
              Copy{action.label ? ` ${action.label.toLowerCase()}` : ''}
            </button>
          </span>
        )

      case 'config': {
        const label = pillLabels[action.configId]
        if (!label) return null
        return (
          <button key={index} type="button" className="step-link" onClick={() => onOpenConfig(action.configId)}>
            {action.label ?? `Open ${label}`} →
          </button>
        )
      }
    }
  }

  return (
    <li className={`checklist-step${done ? ' done' : ''}`}>
      <label className="checklist-step-title">
        <input type="checkbox" checked={done} onChange={(e) => onToggle(e.target.checked)} />
        <span>{step.title}</span>
        {onlyRoute && <span className="step-route-tag">{showingUi ? 'UI only' : 'CLI only'}</span>}
      </label>

      {step.detail && <p className="checklist-step-detail">{step.detail}</p>}

      <div className="checklist-step-body">
        {step.actions.length > 0 && <div className="checklist-step-links">{step.actions.map(renderAction)}</div>}

        {consolePath &&
          (consoleHref ? (
            <a className="step-link step-console" href={consoleHref} target="_blank" rel="noreferrer">
              <LinkIcon />
              Open in {consoleLabel}
            </a>
          ) : (
            <span className="step-link step-link-inert">
              <LinkIcon />
              {consoleLabel} <code>{consolePath}</code>
            </span>
          ))}

        {variant && variant.instructions.length > 0 && (
          <ol className="step-instructions">
            {variant.instructions.map((instruction, i) => (
              <li key={i}>{instruction}</li>
            ))}
          </ol>
        )}

        {variant && variant.actions.length > 0 && <div className="checklist-step-links">{variant.actions.map(renderAction)}</div>}
      </div>
    </li>
  )
}
