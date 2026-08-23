# Supply Chain Security

`.github/workflows/supply-chain.yml` covers SBOM generation, provenance/SBOM attestation, and
two scans - SCA (dependency vulnerabilities) and SAST (source code) - on every push to `main`
and every PR. All tools involved are free and open source (licenses noted below).

## What runs

| Job | Tool | License | What it does |
|---|---|---|---|
| `sbom` | [Syft](https://github.com/anchore/syft), installed and run directly (not via `anchore/sbom-action` - see below) | Apache-2.0 | Generates a CycloneDX SBOM covering the full npm dependency tree (including dev dependencies - the tools, not just what ships) and the GitHub Actions this repo's own workflows use. Uploaded as a workflow artifact. |
| `sbom` | `actions/attest` (SBOM) + `actions/attest-build-provenance` | - | On push to `main` only: cryptographically binds the SBOM, and the `dist/` build output's provenance (which workflow, which commit, which inputs), to this exact build via [Sigstore](https://www.sigstore.dev/) keyless signing. Published to the repo's **Attestations** tab. |
| `sca-sbom` / `sca-source` | [OSV-Scanner](https://github.com/google/osv-scanner) | Apache-2.0 | Two independent passes against the [OSV.dev](https://osv.dev) vulnerability database, each its own job (both call the shared `osv-scan.yml` reusable workflow): `sca-sbom` scans the SBOM generated above, `sca-source` scans the checked-out repo's own `package-lock.json` directly (see below for why both) - `sca-source` has no dependency on the `sbom` job. A final `sca-result` job fails if either pass reported an issue. Results go to **Security → Code scanning** (SARIF, two categories) and as downloadable artifacts. |
| `sast` | [Semgrep](https://github.com/semgrep/semgrep) OSS engine | LGPL-2.1 | Scans the actual source with public, login-free registry rulesets (`p/security-audit`, `p/owasp-top-ten`, `p/typescript`, `p/react`) - no Semgrep account or token involved. Results go to **Security → Code scanning** and as an artifact. |

Separately, `.github/workflows/codeql.yml` runs GitHub's CodeQL SAST (free for public repos, not
fully open source) as a second, independent SAST engine, and `.github/workflows/ci.yml`'s
`gitleaks` job scans for secrets on every push/PR (MIT-licensed; also runs locally as a
pre-commit hook - see `CLAUDE.md`).

## GitHub Actions-specific security linting (`zizmor`)

`actionlint` (in `ci.yml`) checks workflow syntax and embedded shell via shellcheck; Semgrep's
rulesets (above) are generic source-code rules. Neither catches issues specific to how GitHub
Actions itself works - so `.github/workflows/ci.yml`'s `zizmor` job runs
[zizmor](https://github.com/zizmorcore/zizmor) (Apache-2.0/MIT, `pip install
zizmor==1.29.0`), which found (and this repo fixed) three real, non-hypothetical issues during
setup:

- **`excessive-permissions`**: `deploy.yml` declared `pages: write`/`id-token: write` at the
  workflow level, so both its `build` and `deploy` jobs got them even though only `deploy`
  needs them - moved down to the `deploy` job's own `permissions:` block.
- **`artipacked`**: every `actions/checkout` step across every workflow now sets
  `persist-credentials: false` - none of these jobs need the checked-out git credential to
  push anything back, so leaving it persisted only gave a later step in the same job (e.g. a
  compromised `npm ci` dependency) something to steal for nothing.
- **`template-injection`**: `release.yml`'s `gh release upload` step interpolated
  `${{ needs.release.outputs.tag_name }}` directly into the `run:` shell string - moved to an
  environment variable (`TAG_NAME`) instead, so the value is never spliced into the command
  text itself.

Run it locally before editing any workflow file: `uvx zizmor==1.29.0 .` (or
`GH_TOKEN=$(gh auth token) uvx zizmor==1.29.0 .` to match CI's online mode, which resolves a
few audits offline mode can't).

## A second GitHub Actions scanner (`plumber`)

`.github/workflows/ci.yml`'s `plumber` job runs [Plumber](https://github.com/getplumber/plumber)
(MPL-2.0, FOSS) via the official `getplumber/plumber` action - a CI/CD compliance scanner with
its own engine and control set, distinct from `zizmor`'s: exposed/unmasked secrets, mutable
remote-code execution nested inside third-party actions (not just this repo's own workflow YAML,
see the finding below), known-CVE action versions, branch protection, and dangerous triggers.
The action verifies its own downloaded binary against `checksums.txt` and a Sigstore/SLSA
build-provenance attestation before running (mirroring this repo's own philosophy of not
trusting a mutable tag/download blindly), and handles its own SARIF and artifact upload
internally, so - unlike `zizmor`/`gitleaks` - it needs no hand-written second-run/upload steps
in `ci.yml`.

### Resolved Plumber finding (`ISSUE-714`): why Syft isn't installed via `anchore/sbom-action`

Plumber's first scan against this repo found a real issue at **High** severity (score 78/100,
grade B): `anchore/sbom-action` (previously used in both `supply-chain.yml`'s `sbom` job and
`release.yml`'s `build-and-attach` job) downloads Syft by fetching
`https://raw.githubusercontent.com/anchore/syft/main/install.sh` and piping it to `sh` at
runtime - confirmed by reading the action's bundled `dist/index.cjs` (`downloadSyft()`)
directly at the pinned commit. `main` is a mutable ref with no checksum on the script itself, so
pinning `anchore/sbom-action` to a commit SHA (as this repo does everywhere else) does not cover
this nested fetch - a compromise of `anchore/syft`'s `main` branch would be picked up on the
next run regardless of the SBOM action's own pin.

`ISSUE-714` is a static check with no per-finding waiver (only a whole-control on/off toggle in
`.plumber.yaml`) - it flags `anchore/sbom-action`'s mere presence regardless of any caller-side
mitigation, confirmed via Plumber's own docs. So rather than working around the action (or
disabling the control entirely, which would also stop flagging this same pattern in any other
action added later), both jobs install and run Syft directly: a checksum-verified download from
Syft's own GitHub Releases (same pattern as `ci.yml`'s `gitleaks` install), added to `PATH`, then
invoked as `syft scan dir:. -o cyclonedx-json`. This is a faithful equivalent of what
`anchore/sbom-action` was doing internally (confirmed by reading its bundled source: it runs
exactly that command and writes the captured stdout to `output-file` itself) - same `SYFT_*` env
vars, since those are native Syft config read regardless of how the binary is invoked. Plumber
now scores this repo 100/100.

## The release artifact gets its own attestation

`supply-chain.yml`'s `sbom` job attests a `dist/` build on every ordinary push to `main` - but
that's *not* the file anyone downloads. `release.yml`'s `build-and-attach` job does an
independent build against the actual release tag, zips it to `dist.zip`, and attaches that to
the GitHub Release. Since v-next, `build-and-attach` generates its own SBOM (same Syft flags as
above) and runs `attest` (for the SBOM) + `attest-build-provenance` against `dist.zip` itself
before uploading it - so the artifact that ships is the one with provenance, not a same-source
but uncorrelated stand-in.

`actions/attest-sbom` is deprecated (confirmed via its own README: "this action is being
deprecated in favor of `actions/attest`... all of the existing action inputs are compatible")
in favor of the generic `actions/attest` action, using the exact same `subject-path`/
`sbom-path` inputs - so both SBOM-attesting steps in this repo use `actions/attest` directly.
`actions/attest-build-provenance` is not deprecated and stays as-is.

## Why `sca-sbom` and `sca-source` scan both the SBOM and the repository directly

`osv-scanner scan source -L ./sbom.cdx.json` only ever sees what Syft chose to catalog into
`sbom.cdx.json` - a bug or gap in Syft's cataloging (or a deliberate `SYFT_EXCLUDE`/
`SYFT_SELECT_CATALOGERS` setting, see below) would silently narrow what `sca` can find. Running
`osv-scanner scan source -r .` against the freshly checked-out repo is a second, independently
sourced pass: it parses `package-lock.json` itself, with no dependency on the SBOM job having
run correctly first. Neither replaces the other - the SBOM pass is also what proves the exact
artifact that got attested (above) was the one scanned; the repository pass is what proves the
scan doesn't depend on Syft. Both use the same OSV-Scanner action and OSV.dev database, so
running both isn't duplicating a check, it's removing a single point of failure.

## Why the SBOM excludes some things

- **Go stdlib inside TypeScript 7's native `tsc` binary**: TypeScript 7 ships a
  platform-specific native binary (`@typescript/typescript-*`) built with Go. Syft's binary
  cataloger detects the embedded Go stdlib version and reports its CVEs - which aren't
  something this repo can patch (only the TypeScript team can, by rebuilding against a newer
  Go toolchain), and drowned out every real finding in early testing (150 Go stdlib CVEs, 0
  real ones). Excluded via `-go-module-binary-cataloger`.
- **`.github/workflows/*.yml` files shipped inside `node_modules`**: some npm packages include
  their own CI configs in their published source. Syft's GitHub Actions cataloger otherwise
  reports *their* action pins as if this repo used them. Excluded via `SYFT_EXCLUDE`.
- **Raw file entries for this repo's own `.github/workflows/*.yml` files and
  `package-lock.json`**: separately from the *package* catalogers (which correctly emit a
  proper `pkg:github/...`-purled component per `uses:` line, and a `pkg:npm/...`-purled
  component per dependency), Syft's `file-metadata-cataloger` and `file-digest-cataloger` also
  emit each of those source files themselves as bare `type: file` components with no purl -
  essentially duplicate, hash-only records of files whose real package data is already
  captured elsewhere. OSV-Scanner can't match a purl-less file against anything, so it logs
  `Neither CPE nor PURL found for package: ...` once per file - confirmed by generating the
  SBOM locally and inspecting it (`syft . -o syft-json=...`): the real `actions/checkout`
  entry has its own `pkg:github/actions/checkout@v7.0.1` purl regardless, and removing these
  two catalogers dropped exactly those file-only entries (427 → 421 components) with zero
  npm/GitHub-Actions package data lost. Excluded via
  `-file-metadata-cataloger,-file-digest-cataloger`.

If you regenerate the SBOM locally, use the same flags (see below) or you'll see this noise
return.

## Pinning: commit SHAs, not tags - not even major-version tags

Every `uses:` in every workflow is pinned to a full commit SHA with a `# vX.Y.Z` comment, e.g.:

```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
```

This isn't just "don't use `latest`" - a major-version tag like `@v7` is *also* mutable (the
action owner can repoint it), which is exactly how real supply-chain compromises have
happened (e.g. `tj-actions/changed-files` in 2025). Semgrep's `p/security-audit` ruleset flags
mutable action tags as a blocking finding - that's how this was caught during setup here, and
`sast` will catch it again if a future edit reintroduces a bare tag.

**This doesn't mean manual upkeep forever**: `.github/dependabot.yml` understands the
`@<sha> # vX.Y.Z` convention and opens a PR updating both the SHA and the comment together
when a new version ships, for both `npm` and `github-actions` ecosystems.

## Dependabot doesn't cover everything - hence `renovate.json`

`supply-chain.yml`'s `sast` job runs Semgrep inside a container pinned by **Docker digest**
(`semgrep/semgrep@sha256:... # 1.173.0`), not a `uses:` step. Confirmed by reading
[dependabot-core's `github_actions/file_parser.rb`](https://github.com/dependabot/dependabot-core/blob/main/github_actions/lib/dependabot/github_actions/file_parser.rb)
directly: it only walks `uses:`/`steps:` keys, and even there it explicitly skips `docker://`
references (`# TODO: Support Docker references` - never implemented). A job's `container:`
field is never inspected at all. So this digest has **no update path via Dependabot**,
regardless of how it's referenced.

[Renovate](https://github.com/renovatebot/renovate) (AGPL-3.0) does support this - confirmed
the same way, by reading its
[`github-actions` manager source](https://github.com/renovatebot/renovate/blob/main/lib/modules/manager/github-actions/extract.ts):
it explicitly extracts `job.container` (and `job.services`) as their own dependency types
(`depType: 'container'` / `'service'`), separate from regular `uses:` action refs
(`depType: 'action'`).

`renovate.json` is scoped narrowly so the two bots don't overlap: `enabledManagers` restricts
Renovate to the `github-actions` manager only (it never touches npm - Dependabot already does),
and a `packageRules` entry disables the `action`/`github-runner`/`uses-with` dep types Dependabot
already covers, leaving only `container`/`docker`/`service` (the Semgrep image digest today,
and anything similar added later) active. Same 7-day `minimumReleaseAge` cooldown as
Dependabot's, for the same reason.

**Requires one manual step**: unlike Dependabot (built into GitHub, no setup), Renovate needs
its [GitHub App](https://github.com/apps/renovate) installed on this repo/org - free for public
repos. Nothing runs until that's done.

## Running these locally before pushing

```sh
# SBOM (matches the CI job's flags exactly)
SYFT_JAVASCRIPT_INCLUDE_DEV_DEPENDENCIES=true \
SYFT_EXCLUDE='./node_modules/**/.github/**,./dist/**' \
SYFT_SELECT_CATALOGERS='-go-module-binary-cataloger,-file-metadata-cataloger,-file-digest-cataloger' \
syft . -o cyclonedx-json=sbom.cdx.json

# SCA: scan that SBOM, and separately scan the repository/lockfile directly
osv-scanner scan source --lockfile=./sbom.cdx.json
osv-scanner scan source -r --experimental-exclude=./node_modules,./dist .

# SAST
semgrep scan --config=p/security-audit --config=p/owasp-top-ten \
  --config=p/typescript --config=p/react --exclude=node_modules --exclude=dist
```

(`brew install syft osv-scanner`; Semgrep via `pip install semgrep` or the `semgrep/semgrep`
Docker image - see the pinned digest in `supply-chain.yml` for the exact version in use.)

## A caveat worth knowing

Attestations, code scanning alerts, and the Attestations tab are all **GitHub-side** features -
they only exist once this repo is actually pushed to GitHub and a workflow run has completed
there. Nothing about generating the workflow files here "publishes" anything by itself.

## Moving a scan into a reusable workflow resets its code-scanning baseline once

GitHub identifies a code-scanning configuration by `<workflow file>:<job name>` - not by SARIF
category alone. When `sca-sbom`/`sca-source` started calling the shared `osv-scan.yml` reusable
workflow, the job that actually runs the scan is named `scan` (the job id inside `osv-scan.yml`),
so the configuration key became `supply-chain.yml:scan` instead of the old `supply-chain.yml:sca`.
GitHub can't diff a PR's alerts against a configuration that has no baseline yet, so a PR touching
this may show "1 configuration not found" for `osv-scanner` on the Checks tab - this is expected,
not a sign anything's broken. It's a one-time transition: once such a PR merges, `main` runs
under the new key and every subsequent PR diffs normally again. It's also not a real coverage
gap, since it only matters if there are existing alerts to lose track of, and (checked directly
via `gh api repos/<owner>/<repo>/code-scanning/alerts`) this repo has none.
