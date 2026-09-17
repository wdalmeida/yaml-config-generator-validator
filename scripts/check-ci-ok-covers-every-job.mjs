// ci-ok is the only required status check for `main`, so a job missing from its `needs:` is
// enforced by nothing at all - which is exactly how the previous per-context ruleset silently
// stopped covering `helm` and `plumber`. Fail loudly instead.
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'

const WORKFLOW = '.github/workflows/ci.yml'
const GATE = 'ci-ok'

const jobs = parse(readFileSync(WORKFLOW, 'utf8')).jobs
const gate = jobs[GATE]
if (!gate) throw new Error(`${WORKFLOW} has no "${GATE}" job`)

const needs = new Set(Array.isArray(gate.needs) ? gate.needs : [gate.needs].filter(Boolean))
const missing = Object.keys(jobs).filter((id) => id !== GATE && !needs.has(id))
const dangling = [...needs].filter((id) => !jobs[id])

for (const id of missing) console.error(`error: job "${id}" is missing from ${GATE}'s needs:`)
for (const id of dangling) console.error(`error: ${GATE} needs "${id}", which is not a job`)

if (missing.length || dangling.length) process.exit(1)
console.log(`${GATE} covers all ${Object.keys(jobs).length - 1} jobs in ${WORKFLOW}`)
