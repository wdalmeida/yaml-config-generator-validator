import { CONFIG_DEFINITIONS, getConfigDefinition, getDraftStatus } from './configs'
import { ConfigWorkspace } from './components/ConfigWorkspace'
import { usePersistedState } from './lib/persisted-state'
import './App.css'

function App() {
  const [selectedId, setSelectedId] = usePersistedState('selected-config-id', CONFIG_DEFINITIONS[0].id)
  const definition = getConfigDefinition(selectedId)

  return (
    <main className="app">
      <h1>YAML Config Generator &amp; Validator</h1>

      <nav className="config-tabs">
        {CONFIG_DEFINITIONS.map((def) => (
          <button
            key={def.id}
            type="button"
            className={`config-tab${def.id === selectedId ? ' active' : ''}`}
            onClick={() => setSelectedId(def.id)}
          >
            <span className={`status-dot status-${getDraftStatus(def)}`} aria-hidden="true" />
            {def.label}
          </button>
        ))}
      </nav>

      <ConfigWorkspace key={definition.id} definition={definition} />
    </main>
  )
}

export default App
