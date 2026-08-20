# Supply Chain Security

`.github/workflows/supply-chain.yml` covers SBOM generation, provenance/SBOM attestation, and
two scans - SCA (dependency vulnerabilities) and SAST (source code) - on every push to `main`
and every PR. All tools involved are free and open source (licenses noted below).

## What runs

| Job | Tool | License | What it does |
|---|---|---|---|
| `sbom` | [Syft](https://github.com/anchore/syft) (via `anchore/sbom-action`) | Apache-2.0 | Generates a CycloneDX SBOM covering the full npm dependency tree (including dev dependencies - the tools, not just what ships) and the GitHub Actions this repo's own workflows use. Uploaded as a workflow artifact. |
| `sbom` | `actions/attest` (SBOM) + `actions/attest-build-provenance` | - | On push to `main` only: cryptographically binds the SBOM, and the `dist/` build output's provenance (which workflow, which commit, which inputs), to this exact build via [Sigstore](https://www.sigstore.dev/) keyless signing. Published to the repo's **Attestations** tab. |
| `sca` | [OSV-Scanner](https://github.com/google/osv-scanner) | Apache-2.0 | Two independent passes against the [OSV.dev](https://osv.dev) vulnerability database: one scans the SBOM generated above, one scans the checked-out repo's own `package-lock.json` directly (see below for why both). Results go to **Security → Code scanning** (SARIF, two categories) and as downloadable artifacts. |
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

## Why `sca` scans both the SBOM and the repository directly

`osv-scanner scan source -L ./sbom.cdx.json` only ever sees what Syft chose to catalog into
`sbom.cdx.json` - a bug or gap in Syft's cataloging (or a deliberate `SYFT_EXCLUDE`/
`SYFT_SELECT_CATALOGERS` setting, see below) would silently narrow what `sca` can find. Running
`osv-scanner scan source -r .` against the freshly checked-out repo is a second, independently
sourced pass: it parses `package-lock.json` itself, with no dependency on the SBOM job having
run correctly first. Neither replaces the other - the SBOM pass is also what proves the exact
artifact that got attested (above) was the one scanned; the repository pass is what proves the
scan doesn't depend on Syft. Both use the same OSV-Scanner action and OSV.dev database, so
running both isn't duplicating a check, it's removing a single point of failure.

One byproduct worth knowing: the SBOM includes non-package entries (this repo's own
`.github/workflows/*.yml` files, and `package-lock.json` itself, both added by Syft's
respective catalogers as generic "file" components) that have no [Package URL][purl] for
OSV-Scanner to match against - these log as `Neither CPE nor PURL found for package: ...`
in the `sca` job's "Scan SBOM..." step. That's expected noise from files Syft catalogs for
other reasons (the GitHub Actions cataloger, a generic file cataloger), not a sign that real
npm dependencies are being skipped - the scan still reports the actual package count found
(currently ~420) and exits successfully once every real dependency is checked.

[purl]: https://github.com/package-url/purl-spec

## Why the SBOM excludes some things

- **Go stdlib inside TypeScript 7's native `tsc` binary**: TypeScript 7 ships a
  platform-specific native binary (`@typescript/typescript-*`) built with Go. Syft's binary
  cataloger detects the embedded Go stdlib version and reports its CVEs - which aren't
  something this repo can patch (only the TypeScript team can, by rebuilding against a newer
  Go toolchain), and drowned out every real finding in early testing (150 Go stdlib CVEs, 0
  real ones). Excluded via `SYFT_SELECT_CATALOGERS: "-go-module-binary-cataloger"`.
- **`.github/workflows/*.yml` files shipped inside `node_modules`**: some npm packages include
  their own CI configs in their published source. Syft's GitHub Actions cataloger otherwise
  reports *their* action pins as if this repo used them. Excluded via `SYFT_EXCLUDE`.

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
SYFT_SELECT_CATALOGERS='-go-module-binary-cataloger' \
syft . -o cyclonedx-json=sbom.cdx.json

# SCA: scan that SBOM, and separately scan the repository/lockfile directly
osv-scanner scan source --lockfile=./sbom.cdx.json
osv-scanner scan source -r .

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
