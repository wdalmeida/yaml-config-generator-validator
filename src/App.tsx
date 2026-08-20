import { useState } from 'react'
import { GeneratorForm } from './components/GeneratorForm'
import { ValidatorPanel } from './components/ValidatorPanel'
import './App.css'

type Tab = 'generate' | 'validate'

function App() {
  const [tab, setTab] = useState<Tab>('generate')

  return (
    <main className="app">
      <h1>YAML Config Generator &amp; Validator</h1>
      <nav className="tabs">
        <button
          type="button"
          className={tab === 'generate' ? 'active' : ''}
          onClick={() => setTab('generate')}
        >
          Generate
        </button>
        <button
          type="button"
          className={tab === 'validate' ? 'active' : ''}
          onClick={() => setTab('validate')}
        >
          Validate
        </button>
      </nav>
      {tab === 'generate' ? <GeneratorForm /> : <ValidatorPanel />}
    </main>
  )
}

export default App
