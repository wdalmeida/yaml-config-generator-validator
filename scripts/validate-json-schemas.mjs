// Two passes over the JSON files this app loads at build time.
//
// 1. src/configs/schemas/*.schema.json are validated against the real JSON Schema draft 2020-12
//    meta-schema - a check our own converter (src/configs/json-schema.ts) can't give us, since
//    it only cares whether a file satisfies the narrow subset it understands, not whether the
//    file is actually valid JSON Schema in general (e.g. `required` as a string instead of an
//    array would likely be silently ignored by our converter, but is spec-invalid).
//
// 2. src/onboarding/*.onboarding.json are *data*, not schema documents, so the meta-schema has
//    nothing to say about them. They're validated against our own checked-in meta-schema
//    (the same one their $schema key points at, so an editor and CI agree), plus a referential
//    check that every `configId` names a pill that exists. Zod re-checks the same shape
//    at runtime; this pass is what turns a malformed file into a CI failure rather than a
//    white screen.
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const schemasDir = path.join(root, 'src/configs/schemas')
const onboardingDir = path.join(root, 'src/onboarding')

// strict: false - our x-* vendor extensions are unrecognized keywords by design (that's the
// whole point of the x- prefix convention); a compliant JSON Schema validator ignores them
// rather than treating them as an error.
const ajv = new Ajv2020({ strict: false })

let failed = false

function fail(file, message) {
  failed = true
  console.error(`FAIL  ${file}: ${message}`)
}

// --- Pass 1: config schemas are themselves JSON Schema documents -------------------------

const schemaFiles = readdirSync(schemasDir).filter((f) => f.endsWith('.schema.json'))

// Pills a step's `config` action may point at. The config types are discovered below; the
// Kubernetes pill isn't schema-driven (it renders manifests from two inputs rather than
// validating a file), so it's named here - mirroring KUBERNETES_ID in src/kubernetes/index.ts.
const pillIds = new Set(['kubernetes'])

for (const file of schemaFiles) {
  try {
    const schema = JSON.parse(readFileSync(path.join(schemasDir, file), 'utf8'))
    ajv.compile(schema)
    if (schema['x-config-id']) pillIds.add(schema['x-config-id'])
    console.log(`OK    ${file}`)
  } catch (err) {
    fail(file, err instanceof Error ? err.message : err)
  }
}

if (schemaFiles.length === 0) {
  console.error(`No *.schema.json files found in ${schemasDir}`)
  process.exit(1)
}

// --- Pass 2: onboarding checklists are data, checked against our own meta-schema ----------

const onboardingFiles = readdirSync(onboardingDir).filter((f) => f.endsWith('.onboarding.json'))
let validateOnboarding

try {
  validateOnboarding = ajv.compile(JSON.parse(readFileSync(path.join(onboardingDir, 'onboarding.meta.schema.json'), 'utf8')))
} catch (err) {
  fail('onboarding.meta.schema.json', err instanceof Error ? err.message : err)
}

if (onboardingFiles.length === 0) {
  console.error(`No *.onboarding.json files found in ${onboardingDir}`)
  process.exit(1)
}

if (validateOnboarding) {
  for (const file of onboardingFiles) {
    try {
      const doc = JSON.parse(readFileSync(path.join(onboardingDir, file), 'utf8'))

      if (!validateOnboarding(doc)) {
        fail(file, ajv.errorsText(validateOnboarding.errors, { separator: '; ' }))
        continue
      }

      // Referential integrity the meta-schema can't express: a `config` action must name a
      // pill that exists, or the step renders a button that goes nowhere.
      const missing = []
      const seenStepIds = new Set()
      for (const step of doc.steps) {
        if (seenStepIds.has(step.id)) fail(file, `duplicate step id: ${step.id}`)
        seenStepIds.add(step.id)

        // Semantic, so the meta-schema can't express it: a command is by definition the CLI
        // route, and one in the path-independent list would be shown to a reader who explicitly
        // selected the UI route - the one thing that switch exists to prevent.
        if ((step.actions ?? []).some((action) => action.type === 'command')) {
          fail(file, `step "${step.id}": a command action belongs in \`cli.actions\`, not in the step's own \`actions\``)
        }

        for (const action of [...(step.actions ?? []), ...(step.cli?.actions ?? []), ...(step.ui?.actions ?? [])]) {
          if (action.type === 'config' && !pillIds.has(action.configId)) {
            missing.push(`${step.id} -> ${action.configId}`)
          }
        }
      }
      if (missing.length > 0) {
        fail(file, `config action names an unknown pill: ${missing.join(', ')}`)
        continue
      }

      console.log(`OK    ${file}`)
    } catch (err) {
      fail(file, err instanceof Error ? err.message : err)
    }
  }
}

if (failed) process.exit(1)
