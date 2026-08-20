# Supply Chain Security

`.github/workflows/supply-chain.yml` covers SBOM generation, provenance/SBOM attestation, and
two scans - SCA (dependency vulnerabilities) and SAST (source code) - on every push to `main`
and every PR. All tools involved are free and open source (licenses noted below).

## What runs

| Job | Tool | License | What it does |
|---|---|---|---|
| `sbom` | [Syft](https://github.com/anchore/syft) (via `anchore/sbom-action`) | Apache-2.0 | Generates a CycloneDX SBOM covering the full npm dependency tree (including dev dependencies - the tools, not just what ships) and the GitHub Actions this repo's own workflows use. Uploaded as a workflow artifact. |
| `sbom` | `actions/attest-sbom` + `actions/attest-build-provenance` | - | On push to `main` only: cryptographically binds the SBOM, and the `dist/` build output's provenance (which workflow, which commit, which inputs), to this exact build via [Sigstore](https://www.sigstore.dev/) keyless signing. Published to the repo's **Attestations** tab. |
| `sca` | [OSV-Scanner](https://github.com/google/osv-scanner) | Apache-2.0 | Scans the SBOM generated above (not just the lockfile) against the [OSV.dev](https://osv.dev) vulnerability database. Results go to **Security → Code scanning** (SARIF) and as a downloadable artifact. |
| `sast` | [Semgrep](https://github.com/semgrep/semgrep) OSS engine | LGPL-2.1 | Scans the actual source with public, login-free registry rulesets (`p/security-audit`, `p/owasp-top-ten`, `p/typescript`, `p/react`) - no Semgrep account or token involved. Results go to **Security → Code scanning** and as an artifact. |

Separately, `.github/workflows/codeql.yml` runs GitHub's CodeQL SAST (free for public repos, not
fully open source) as a second, independent SAST engine, and `.github/workflows/ci.yml`'s
`gitleaks` job scans for secrets on every push/PR (MIT-licensed; also runs locally as a
pre-commit hook - see `CLAUDE.md`).

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

## Running these locally before pushing

```sh
# SBOM (matches the CI job's flags exactly)
SYFT_JAVASCRIPT_INCLUDE_DEV_DEPENDENCIES=true \
SYFT_EXCLUDE='./node_modules/**/.github/**,./dist/**' \
SYFT_SELECT_CATALOGERS='-go-module-binary-cataloger' \
syft . -o cyclonedx-json=sbom.cdx.json

# SCA: scan that SBOM
osv-scanner scan source --sbom=./sbom.cdx.json

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
