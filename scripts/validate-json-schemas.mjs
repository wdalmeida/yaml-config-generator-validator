// Validates every src/configs/schemas/*.schema.json file against the real JSON Schema
// draft 2020-12 meta-schema - a check our own converter (src/configs/json-schema.ts) can't
// give us, since it only cares whether a file satisfies the narrow subset it understands, not
// whether the file is actually valid JSON Schema in general (e.g. `required` as a string
// instead of an array would likely be silently ignored by our converter, but is spec-invalid).
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'

const schemasDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/configs/schemas')
// strict: false - our x-* vendor extensions are unrecognized keywords by design (that's the
// whole point of the x- prefix convention); a compliant JSON Schema validator ignores them
// rather than treating them as an error.
const ajv = new Ajv2020({ strict: false })

const files = readdirSync(schemasDir).filter((f) => f.endsWith('.schema.json'))
let failed = false

for (const file of files) {
  const fullPath = path.join(schemasDir, file)
  try {
    const schema = JSON.parse(readFileSync(fullPath, 'utf8'))
    ajv.compile(schema)
    console.log(`OK    ${file}`)
  } catch (err) {
    failed = true
    console.error(`FAIL  ${file}: ${err instanceof Error ? err.message : err}`)
  }
}

if (files.length === 0) {
  console.error(`No *.schema.json files found in ${schemasDir}`)
  process.exit(1)
}

if (failed) process.exit(1)
