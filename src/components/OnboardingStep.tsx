import { jiraUrlFor } from '../onboarding/jira'
import type { OnboardingAction, OnboardingStep as Step } from '../onboarding'
import { DocsIcon, LinkIcon, TerminalIcon, TicketIcon } from './icons'

interface OnboardingStepProps {
  step: Step
  done: boolean
  onToggle: (done: boolean) => void
  jiraBaseUrl: string
  // Label for a `config` action's target pill, keyed by config id. An action naming a config
  // type that no longer exists renders nothing rather than a dead button - forgiving at runtime
  // so deleting a schema file can't white-screen the app, while lint:schemas fails on it.
  configLabels: Record<string, string>
  onOpenConfig: (configId: string) => void
}

// Fully controlled, no local state - same contract as FieldRow.
export function OnboardingStep({ step, done, onToggle, jiraBaseUrl, configLabels, onOpenConfig }: OnboardingStepProps) {
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
        const label = configLabels[action.configId]
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
      </label>
      {step.detail && <p className="checklist-step-detail">{step.detail}</p>}
      {step.actions.length > 0 && <div className="checklist-step-links">{step.actions.map(renderAction)}</div>}
    </li>
  )
}
