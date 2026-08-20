# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static site (no backend) that helps users fill out and validate the YAML config files our software requires in its repository, so they stop hand-editing them incorrectly. Supports multiple independent file types in parallel — Tenant Config (`config.yaml`), CI (`ci.yml`), CD (`cd.yml`), Env (`env.yml`), Protection (`protection.yml`) — switchable via the pill strip at the top, each with its own schema and its own in-progress draft (persisted to `localStorage`, so switching types never loses work).

Each config type is one two-column screen (`ConfigWorkspace`), not separate Generate/Validate tabs: the **left column** is identical in structure across every config type — target file location (owner/repo/branch/path) plus a shared "Load & validate" box (fetch from GitHub or paste YAML, then Validate to check it or Load into form to start editing it) — while the **right column** is per-type — the schema's own fields, the generated YAML output, and Push to GitHub.

**The CI/CD/Env/Protection schemas are placeholders** (`src/configs/schemas/{ci,cd,env,protection}.schema.json`) — guessed field lists, not yet confirmed against the real config specs. Expect to replace their fields; `tenant-config.schema.json` is the one built from real requirements.

## Commands

```sh
npm run dev      # start dev server
npm run build    # tsc -b && vite build (type errors fail the build)
npm run lint     # oxlint
npm test         # vitest run (all tests)
npx vitest run src/lib/yaml.test.ts   # single test file
npx vitest       # watch mode
```

Linting uses **oxlint**, not eslint — config is `.oxlintrc.json`.

`.github/workflows/ci.yml` runs lint, build, and test on every push to `main` and every PR — the exact same three commands above, in that order. `.github/workflows/deploy.yml` is separate: it only builds and publishes `dist/` to GitHub Pages on push to `main` (see `docs/deploying-to-github-pages.md`), it doesn't lint or test.

## Architecture

**Every config type is authored as a standard JSON Schema file, not TypeScript.** `src/configs/schemas/*.schema.json` are real JSON Schema documents (`https://json-schema.org/draft/2020-12/schema`) — the `title`/`type`/`properties`/`required`/`minLength`/`maxLength`/`pattern`/`enum`/`minimum`/`maximum`/`items`/`minItems` keywords mean exactly what the spec says. A tiny converter (`src/configs/json-schema.ts`) derives *both* the Zod validator and the form's field list from the same JSON Schema document at build time, so there is no separate hand-written schema to keep in sync — see `docs/adding-a-schema.md` for the authoring guide (keyword reference, worked examples, what's deliberately not supported).

`src/configs/index.ts` auto-discovers every `*.schema.json` file via `import.meta.glob` and builds a `ConfigDefinition` from each — **dropping in a new `.schema.json` file is the entire integration, no other code needs to change** (add its `x-config-id` to `DISPLAY_ORDER` only if it needs a specific pill position rather than landing at the end).

### The config registry (`src/configs/`)

- `src/configs/json-schema.ts` — the JSON-Schema-subset types (`ConfigJsonSchema`, `JsonSchemaProperty`, `JsonSchemaComputedGroup`) and `configDefinitionFromJsonSchema(schema)`, which builds the Zod validator (`zodFromObjectProperties`/`zodFromProperty`) and the `FieldDescriptor[]` (`fieldsFromProperties`/`fieldFromProperty`) from one JSON Schema document. **A `"string"` property not listed in its object's `required` array becomes a `toggle-text` field, not a plain optional text box** — tick a checkbox to reveal a text input; unticked, the key is entirely absent from the output. **A root-level `x-computed-groups` entry replaces a set of target properties with one `computed-toggle-group` field** — one shared base text input plus a checkbox per target; the target's real value is computed as `${base}-${suffix}`, never typed directly. This is the mechanism behind `ci.schema.json`'s `registryDocker`/`registryMaven`: the user types a registry name once, ticks Docker/Maven independently, and can't set either computed value to anything other than `base-docker`/`base-maven`. `x-*` keys are vendor extensions (spec-legal - unknown keys are ignored by any conforming validator) covering what JSON Schema has no keyword for: `x-config-id`/`x-default-filename`/`x-computed-groups` (root-level), `x-widget: "select-or-text"` (an enum is *suggested* options, not a strict `z.enum()` - any string within `maxLength` is valid; used for tenant), `x-placeholder`, `x-item-label` (the noun in a `list-object` array's "Add ___" button).
- `src/configs/types.ts` — `FieldDescriptor` (a small declarative union: `text`, `number`, `boolean`, `select`, `select-or-text`, `list-string`, `list-object`, `toggle-text`, `computed-toggle-group`) and `ConfigDefinition<T>` (`{ id, label, defaultFilename, schema, fields }`) - this is the runtime contract `json-schema.ts` produces and everything else (`FieldRow`, `ConfigWorkspace`) consumes; it doesn't know or care that its data came from JSON. Also the draft-handling helpers every config type shares:
  - `emptyDraftFor(definition)` — seeds a fresh draft: one blank row per list field, the first option for selects/`select-or-text` (so e.g. tenant opens on "Existing: acme" rather than a blank "New" box), `null` for `toggle-text` (unticked), `{ base: '', ticked: {} }` for `computed-toggle-group`.
  - `draftToCandidate` / `parseDraft(definition, draft)` — strips untouched blank rows (a list-string entry that's just whitespace, a list-object row where every text/select field is blank — booleans/numbers don't count toward "blank", see `objectHasContent`) before running the zod schema, so an untouched list field doesn't spam "required" errors before the user has typed anything. Also drops a `toggle-text` field entirely from the candidate object when its value is `null` (rather than passing an empty string through), and fans a `computed-toggle-group`'s single draft key out into each ticked target's own real key (`${base}-${suffix}`, or `''` — not the garbled suffix — if the base is still blank) — the group's own synthetic key never appears in the candidate at all.
  - `draftHasContent` — used only for the pill status dots (see below).
- `src/configs/schemas/{tenant-config,ci,cd,env,protection}.schema.json` — one JSON Schema document per file type. The tenant `enum` (existing tenant names) lives directly in `tenant-config.schema.json`'s `tenant` property - edit it there when tenants are added/removed (each must stay ≤ 12 chars, matching `maxLength`).
- `src/configs/index.ts` — glob-discovers the schema files, builds `CONFIG_DEFINITIONS` (sorted by `DISPLAY_ORDER`, unlisted ids appended at the end), `getConfigDefinition(id)`, and `getDraftStatus(definition)` (reads a type's persisted draft straight from `localStorage`, without mounting its form, to badge pills for types that aren't currently open).

**What the JSON Schema subset deliberately does not support**: `$ref`, `oneOf`/`anyOf`/`allOf`, conditionals (`if`/`then`), computed/derived fields (a field whose value is calculated from other fields rather than typed in), and cross-field validation (a `.refine()`-style rule spanning multiple properties). None of the current five config types need any of these. If a real requirement needs one, it's a deliberate extension to `json-schema.ts` (and worth discussing the design first) - not something to fake with a placeholder field.

### Generic form rendering (`src/components/fields/FieldRow.tsx`)

One recursive component renders every field type for every config, driven purely by its `FieldDescriptor`. `list-object` fields (e.g. `githubTopics`, env `variables`) recurse into `FieldRow` for each item field with `compact` set, so item rows render as one inline strip (select/inputs/checkbox side by side) rather than stacked labeled blocks. `select-or-text` (currently only tenant) renders an Existing/New radio pair; the "New" input's `maxLength` comes from the field descriptor. `toggle-text` renders a checkbox that reveals a text input only when checked; unchecking clears the value back to `null` rather than just hiding a stale string. `computed-toggle-group` renders one shared base input plus a checkbox per target - there is no text input for a target's own value, since the user never sets it directly.

### `ConfigWorkspace` (`src/components/ConfigWorkspace.tsx`)

Takes a `definition: ConfigDefinition` prop and contains zero schema-specific logic — `App.tsx` remounts it with `key={definition.id}` when the user switches pills, which is also what gives each config type its own isolated `usePersistedState` drafts (see below) without any shared-state plumbing.

- Draft state (`Record<string, unknown>`, one field per key) → `parseDraft` → `dataToYaml` for the right column's Output panel; `FieldRow` renders the right column's fields from `definition.fields`.
- The left column's paste box drives three actions, all funneling through `parseYaml(definition.schema, ...)` into one shared `PasteBoxResult` (so there's a single feedback area, not three): **Fetch from GitHub** fills the textarea via `fetchFileContent` (doesn't touch the draft); **Validate** parses the textarea and reports valid/invalid without touching the draft; **Load into form** parses the textarea and, only if valid, replaces the whole draft (`{ ...emptyDraftFor(definition), ...parsed.data }`) and clears the textarea.
- Push to GitHub (bottom of the right column) is unchanged from before: `checkFileExists` → create/edit link, same as documented below.

### Persistence (`src/lib/persisted-state.ts`)

`usePersistedState(key, initial)` is a drop-in `useState` that also syncs to `localStorage` under a namespaced key — purely client-side, works identically on any static host (GitHub Pages included). Keys used: `draft:<configId>` (per-type form draft), `github-owner` / `github-repo` / `github-branch` (shared across types — same target repo), `github-path:<configId>` (per-type, defaults to `definition.defaultFilename`), `selected-config-id` (last-open pill). `readPersistedState` is the non-hook read used by `getDraftStatus` to badge pills that aren't mounted.

### YAML + schema plumbing (`src/lib/yaml.ts`)

`dataToYaml(data)` (stringify, any shape) and `parseYaml(schema, source)` (parse + `schema.safeParse`, returning a `ParseYamlResult<T>` that distinguishes a YAML syntax error (`yamlError`) from a schema validation failure (`issues: ZodIssue[]`)) are schema-agnostic — every config type calls the same two functions with its own zod schema.

### GitHub integration (`src/lib/github.ts`)

The entire GitHub integration, intentionally with no OAuth, no GitHub App, no token handling; every call is an unauthenticated request to GitHub's public API, so all of this only works reliably for public repos.

- `checkFileExists` first confirms the repo itself is visible unauthenticated (`GET /repos/<owner>/<repo>`) before trusting a 404 on the contents endpoint as "missing" — GitHub returns an identical 404 for "path doesn't exist" and "repo is private/nonexistent", so skipping that repo-level check makes every private repo look like the file is missing (this was a real bug: it reported "missing" for a file that existed in a private repo, hiding the "open file to update" link entirely). Private repos and rate-limited requests both come back as `'unknown'` — there's no way to tell those apart without a token.
- `fetchFileContent` fetches and base64-decodes a file's current content (same public-API/private-repo limitation as above), used by "Load from GitHub".
- `buildCreateFileUrl` builds a `github.com/<owner>/<repo>/new/<branch>?filename=...&value=...` link for a new file; `buildEditFileUrl` builds a `github.com/<owner>/<repo>/edit/<branch>/<path>` link for an existing one. **The `/new` page rejects prefilled content if the file already exists** ("A file with the same name already exists"), and the `/edit` page has no equivalent `value=` param to prefill a replacement — GitHub just doesn't support prefilling an update over the URL. `ConfigWorkspace` works around this by requiring the user to hit "Get GitHub link" first, which runs `checkFileExists` and only then reveals the right link (create vs. edit-and-paste-manually vs. both, if existence is unknown). The "open file to update" link's `onClick` also copies the YAML to the clipboard before GitHub's editor opens, so the user only has to select-all-and-paste there — a deliberately small, secret-free automation.

Don't add token-based or OAuth push/fetch flows without checking with the user first — no-auth was explicitly chosen to keep this a public, backend-less tool; full auto-commit (no page visit at all) would need one and was explicitly deferred.

### Other

- Pill status dots (`App.tsx`, `.status-dot` in `App.css`): grey = empty, amber = draft (some content, not yet valid), green = valid. Computed fresh on every `App` render via `getDraftStatus`, so they update when you switch away from a type and back, but not live while you're still typing in the currently open one (an acceptable tradeoff to avoid lifting all five types' state into `App`).

## Schema assumptions worth knowing

Tenant Config's constraints were specified by the user narrowly (tenant length, topic method enum) or inferred where the spec was silent; CI/CD/Env/Protection are wholesale placeholders (see above). Check with the user before tightening/loosening any of these further. (All of these live in `src/configs/schemas/*.schema.json` now - this is a summary, not a second source of truth.)

- `tenant-config`: `tenant` required, ≤ 12 chars, either typed new or picked from the `enum` in the schema file; `product` required non-empty; `proxyEntries` list min 1, each matching a (possibly wildcard) domain pattern like `*.github.com`; `githubTopics` list min 1, each `{ method: 'artefact' | 'environment' | 'script', name, description }` (name/description required non-empty).
- `ci`: `{ runtime: 'node'|'python'|'go'|'java', runtimeVersion, buildCommand, testCommand, triggerBranches: string[], registryDocker?, registryMaven? }` — placeholder, except the registry group (real, confirmed requirement): one shared registry-name input, Docker/Maven ticked independently, each computing its own value as `${name}-docker`/`${name}-maven` — the user cannot set either value directly.
- `cd`: `{ environment: 'staging'|'production', deployCommand, requiresApproval: boolean, notifyChannel }` — placeholder.
- `env`: `{ variables: { name, value, secret: boolean }[] }` — placeholder.
- `protection`: `{ branch, requiredApprovingReviews: integer (1-6), requiredStatusChecks: string[], enforceAdmins: boolean }` — placeholder.
