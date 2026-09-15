import { useState } from 'react'
import { ConfigWorkspace } from './components/ConfigWorkspace'
import { OnboardingWorkspace } from './components/OnboardingWorkspace'
import { usePersistedState } from './lib/persisted-state'
import { getNavEntry, NAV_ENTRIES, navStatus } from './nav'
import './App.css'

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
    <main className="app">
      <h1>YAML Config Generator &amp; Validator</h1>

      <nav className="config-tabs">
        {NAV_ENTRIES.map((navEntry) => (
          <button
            key={navEntry.id}
            type="button"
            // Compared against the resolved entry, not selectedId, so a stale persisted id still
            // highlights the pill whose workspace is actually on screen.
            className={`config-tab${navEntry.id === entry.id ? ' active' : ''}`}
            onClick={() => setSelectedId(navEntry.id)}
          >
            <span className={`status-dot status-${navStatus(navEntry)}`} aria-hidden="true" />
            {navEntry.label}
          </button>
        ))}
      </nav>

      {entry.kind === 'onboarding' ? (
        <OnboardingWorkspace
          key={entry.id}
          definition={entry.definition}
          onOpenConfig={setSelectedId}
          onSeeded={() => refreshStatusDots((n) => n + 1)}
        />
      ) : (
        <ConfigWorkspace key={entry.id} definition={entry.definition} />
      )}
    </main>
  )
}

export default App
