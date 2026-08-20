import { useState } from 'react'
import { parseYamlConfig } from '../lib/yaml'

export function ValidatorPanel() {
  const [source, setSource] = useState('')
  const [result, setResult] = useState<ReturnType<typeof parseYamlConfig> | null>(null)

  return (
    <div className="panel">
      <section>
        <h2>Paste YAML to validate</h2>
        <textarea
          className="yaml-input"
          rows={16}
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder={'tenant: acme\nproduct: checkout\nproxyEntries:\n  - "*.github.com"\ngithubTopics:\n  - method: artefact\n    name: billing\n    description: Billing service'}
        />
        <button type="button" onClick={() => setResult(parseYamlConfig(source))}>
          Validate
        </button>
      </section>

      {result && (
        <section>
          <h2>Result</h2>
          {result.success ? (
            <p className="success">Valid config.</p>
          ) : 'yamlError' in result ? (
            <p className="error">YAML syntax error: {result.yamlError}</p>
          ) : (
            <ul className="errors">
              {result.issues.map((issue, i) => (
                <li key={i}>
                  {issue.path.join('.') || '(root)'}: {issue.message}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
