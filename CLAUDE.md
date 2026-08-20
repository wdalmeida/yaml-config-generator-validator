# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static site (no backend) that helps users fill out and validate the YAML config file our software requires in its repository, so they stop hand-editing it incorrectly. Two modes: **Generate** (form → valid YAML, copy/paste or push to GitHub) and **Validate** (paste YAML → schema errors).

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

## Architecture

**The Zod schema in `src/schema/config.ts` is the single source of truth.** Both the generator form and the validator import it — the form does `configSchema.safeParse(...)` on every keystroke to decide whether to render YAML output, and the validator parses YAML text then runs the same `safeParse`. Field constraints (e.g. tenant max length, proxy entry domain pattern, github topic method enum) live only in that file; when the config shape changes, edit the schema first and both UI paths pick it up.

- `src/schema/config.ts` — Zod schema + inferred `Config`/`GithubTopic` types + the `TOPIC_METHODS` enum (`artefact`, `environment`, `script`).
- `src/data/tenants.ts` — hardcoded list of existing tenant names a user can pick instead of typing a new one. Update this file when tenants are added/removed; each name must stay ≤ 12 chars (the schema enforces this at parse time too).
- `src/lib/yaml.ts` — `configToYaml` (stringify) and `parseYamlConfig` (parse + validate, returning a distinct shape for YAML syntax errors vs. schema validation errors — see `ParseYamlConfigResult`).
- `src/lib/github.ts` — the entire "push to GitHub" integration, intentionally with no OAuth, no GitHub App, no token handling. `checkFileExists` calls GitHub's public, unauthenticated contents API to tell whether the target path already exists on the branch (private repos and rate-limited requests both come back as `'unknown'` — there's no way to tell those apart without a token). `buildCreateFileUrl` builds a `github.com/<owner>/<repo>/new/<branch>?filename=...&value=...` link for a new file; `buildEditFileUrl` builds a `github.com/<owner>/<repo>/edit/<branch>/<path>` link for an existing one. **The `/new` page rejects prefilled content if the file already exists** ("A file with the same name already exists"), and the `/edit` page has no equivalent `value=` param to prefill a replacement — GitHub just doesn't support prefilling an update over the URL. `GeneratorForm` works around this by requiring the user to hit "Get GitHub link" first, which runs `checkFileExists` and only then reveals the right link (create vs. edit-and-paste-manually vs. both, if existence is unknown). Don't add auth-based push flows without checking with the user first — it was explicitly chosen to keep this a public, backend-less tool.
- `src/components/GeneratorForm.tsx` / `ValidatorPanel.tsx` — the two tab bodies, switched in `src/App.tsx`.

## Schema assumptions worth knowing

These constraints were specified by the user narrowly (tenant length, topic method enum) or inferred where the spec was silent — check with the user before tightening/loosening them further:

- `tenant`: required, ≤ 12 chars, either typed new or picked from `EXISTING_TENANTS`.
- `product`: required non-empty string, no other constraints given.
- `proxyEntries`: list, min 1 entry, each must match a (possibly wildcard) domain pattern like `*.github.com`.
- `githubTopics`: list, min 1 entry, each `{ method: 'artefact' | 'environment' | 'script', name, description }` (name/description required non-empty).
