# Every third-party tool the GitHub Actions workflows install on the runner, so the same
# checks can run locally through `just`. `just install` runs `brew bundle` over this file.
#
# Homebrew installs the *current* version of a formula; the workflows pin an exact one and
# Renovate bumps it weekly ("workflow tool versions" group in renovate.json). `just doctor`
# compares the two and flags any drift, and `just install-pinned` fetches the exact pinned
# build - checksum-verified, the same way the workflows do - into .ci-tools/bin, which the
# justfile puts ahead of Homebrew on PATH.

# --- ci.yml -----------------------------------------------------------------------------
brew "actionlint"  # actionlint job - lints the workflow YAML itself
brew "gitleaks"    # gitleaks job - secret scanning
brew "zizmor"      # zizmor job - GitHub Actions security linter
#
# plumber (the second, independent Actions scanner) is deliberately NOT installed from its
# getplumber/plumber tap: Homebrew refuses to load a formula from an untrusted third-party tap
# without an explicit `brew trust`, and the tap tracks a newer release than ci.yml's action
# pins anyway. `just install` fetches the pinned build instead - checksum-verified plus, when
# the gh CLI is around, the same SLSA provenance check the action itself does.

# --- supply-chain.yml -------------------------------------------------------------------
brew "syft"        # sbom job - CycloneDX SBOM
brew "osv-scanner" # sca-sbom / sca-source jobs - OSV.dev vulnerability passes
brew "semgrep"     # sast job (the runner uses the pinned semgrep/semgrep container image)

# --- container.yml ----------------------------------------------------------------------
brew "hadolint"    # hadolint job - Containerfile linting
brew "trivy"       # scan job - image CVE/secret/misconfig scanning
brew "podman"      # build + smoke jobs - the runner uses buildah, which builds the same
                   # Containerfile; it deliberately sticks to plain OCI instructions so
                   # buildah/podman/docker all produce the same image (see docs/container.md)

# --- plumbing the recipes themselves use ------------------------------------------------
brew "jq"          # `just artifacts` reads finding counts out of the SARIF reports

# uv is deliberately not listed either: it is only needed by `just install-pinned zizmor|semgrep`
# (the exact-version fallback for the two Python tools) and is commonly already installed
# outside Homebrew. That recipe says `brew install uv` if it needs one and finds none.

# Node is deliberately NOT here: Homebrew's `node` is a major ahead of the `node-version: 24`
# the workflows run on, and installing it over whatever version manager is already in use is
# not Homebrew's call to make. `just doctor` checks the major instead.
