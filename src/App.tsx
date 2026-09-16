import { useState } from 'react'
import { ConfigWorkspace } from './components/ConfigWorkspace'
import { KubernetesWorkspace } from './components/KubernetesWorkspace'
import { OnboardingWorkspace } from './components/OnboardingWorkspace'
import { usePersistedState } from './lib/persisted-state'
import { getNavEntry, NAV_ENTRIES, navStatus } from './nav'
import './App.css'

// Spoken form of what the status dot shows in colour. "Not started" rather than "empty"
// because it is read as part of a sentence: "Tenant Config, not started".
const STATUS_LABELS = {
  empty: 'not started',
  draft: 'in progress, not yet valid',
  valid: 'valid',
} as const

function App() {
  const [selectedId, setSelectedId] = usePersistedState('selected-config-id', NAV_ENTRIES[0].id)
  // Resolved, not thrown: the persisted id lives in the user's browser and can outlive the entry
  // it names (a schema file renamed or deleted), which used to render an unrecoverable blank page.
  const entry = getNavEntry(selectedId)
  // Exists only to force the one re-render that re-reads every pill's status dot. Seeding writes
  // other types' drafts straight to localStorage, which App can't otherwise observe, so without
  // this the seed receipt would contradict the dots sitting right next to it.
  const [, refreshStatusDots] = useState(0)

  return (
    <>
      {/* First thing in the tab order, visible only while focused. The pill strip is six
          controls before the workspace on every page load, and a keyboard or screen-reader
          user should not have to walk past all of them to reach the form they came for. */}
      <a className="skip-link" href="#workspace">
        Skip to content
      </a>

      <main className="app">
        <h1>YAML Config Generator &amp; Validator</h1>

        <nav className="config-tabs" aria-label="File type">
          {NAV_ENTRIES.map((navEntry) => {
            // Compared against the resolved entry, not selectedId, so a stale persisted id
            // still highlights the pill whose workspace is actually on screen.
            const isActive = navEntry.id === entry.id
            const status = navStatus(navEntry)
            return (
              <button
                key={navEntry.id}
                type="button"
                // Which pill is open was conveyed only by a CSS class, so a screen reader
                // announced six identical-sounding buttons. aria-current is the navigation
                // idiom for it - deliberately not role="tab", which would oblige this to
                // implement arrow-key roving focus and aria-controls to match the pattern's
                // contract. These are links between views, not tabs in a tabpanel widget.
                aria-current={isActive ? 'page' : undefined}
                className={`config-tab${isActive ? ' active' : ''}`}
                onClick={() => setSelectedId(navEntry.id)}
              >
                <span className={`status-dot status-${status}`} aria-hidden="true" />
                {navEntry.label}
                {/* The dot's colour is the only carrier of this state on screen, which fails
                    WCAG 1.4.1 on its own and leaves it simply absent for anyone not looking at
                    it. The text is hidden visually and read out as part of the pill's name. */}
                <span className="visually-hidden">, {STATUS_LABELS[status]}</span>
              </button>
            )
          })}
        </nav>

        {/* The skip link's target, and the thing that changes when a pill is clicked. tabIndex
            -1 makes it programmatically focusable without adding it to the tab order, so the
            skip link actually moves focus rather than just scrolling. */}
        <div id="workspace" tabIndex={-1}>
          {entry.kind === 'onboarding' && (
            <OnboardingWorkspace
              key={entry.id}
              definition={entry.definition}
              onOpenConfig={setSelectedId}
              onSeeded={() => refreshStatusDots((n) => n + 1)}
            />
          )}
          {entry.kind === 'config' && <ConfigWorkspace key={entry.id} definition={entry.definition} />}
          {entry.kind === 'kubernetes' && <KubernetesWorkspace key={entry.id} />}
        </div>
      </main>
    </>
  )
}

export default App
