# Local replica of the GitHub Actions CI in .github/workflows/, so the inner loop is
# `just ci` rather than push-and-wait-five-minutes, and so every report those workflows
# upload as an artifact (SARIF, SBOM, coverage) can be opened locally.
#
# Two rules keep this honest:
#   1. Every tool version comes out of the workflow files themselves (the greps below) -
#      there is no second list to keep in sync, and Renovate's weekly bumps land here for
#      free.
#   2. Every command mirrors the one the workflow runs. Where a runner-only step can't be
#      replicated (SARIF upload to code scanning, Sigstore attestation, GHCR publish), the
#      recipe says so instead of pretending.
#
# `just install` installs the tools (Homebrew, see Brewfile); `just doctor` reports what's
# missing or version-drifted; `just artifacts` summarises what a run produced.

set shell := ["bash", "-euo", "pipefail", "-c"]

# Pinned tools live under .ci-tools/<os>-<arch>/bin, not .ci-tools/bin: the workspace is shared
# with the devcontainer (and any other machine you open it on), and a macOS binary sitting on
# the PATH of a Linux container is a confusing way to find that out.
# `just tools_dir=/usr/local install-pinned <tool>` overrides the lot and installs system-wide -
# that is how .devcontainer/Dockerfile bakes the pinned tools into its image.
tools_root := justfile_directory() / ".ci-tools"
platform   := os() + "-" + arch()
tools_dir  := tools_root / platform
tools_bin  := tools_dir / "bin"
out       := ".ci-out"
image     := "localhost/yaml-config-generator-validator:ci"

# Exact-pin downloads (`just install-pinned`) win over whatever Homebrew has.
export PATH := tools_bin + ":" + env('PATH')

sha256 := if os() == "macos" { "shasum -a 256" } else { "sha256sum" }

# --- versions, read straight out of the workflows -----------------------------------------
# Each of these matches the same string Renovate's custom regex managers match (renovate.json),
# so a bumped pin is picked up here with no edit.
actionlint_version    := `grep -ohE 'download-actionlint\.bash\)[[:space:]]+[0-9.]+' .github/workflows/ci.yml | head -1 | grep -oE '[0-9.]+$'`
actionlint_script_sha := `grep -ohE 'actionlint/[0-9a-f]{40}/scripts/download-actionlint\.bash' .github/workflows/ci.yml | head -1 | cut -d/ -f2`
gitleaks_version      := `grep -rhoE 'GITLEAKS_VERSION:[[:space:]]*[0-9.]+' .github/workflows | head -1 | grep -oE '[0-9.]+'`
zizmor_version        := `grep -rhoE 'pip install zizmor==[0-9.]+' .github/workflows | head -1 | grep -oE '[0-9.]+$'`
plumber_version       := `grep -rhoE 'getplumber/plumber@[0-9a-f]{40} # v[0-9.]+' .github/workflows | head -1 | awk '{print $NF}' | tr -d v`
syft_version          := `grep -rhoE 'SYFT_VERSION:[[:space:]]*[0-9.]+' .github/workflows | head -1 | grep -oE '[0-9.]+'`
osv_version           := `grep -rhoE 'OSV_SCANNER_VERSION:[[:space:]]*[0-9.]+' .github/workflows | head -1 | grep -oE '[0-9.]+'`
semgrep_version       := `grep -ohE 'semgrep/semgrep@sha256:[0-9a-f]+ # [0-9.]+' .github/workflows/supply-chain.yml | head -1 | awk '{print $NF}'`
hadolint_version      := `grep -rhoE 'HADOLINT_VERSION:[[:space:]]*[0-9.]+' .github/workflows | head -1 | grep -oE '[0-9.]+'`
trivy_version         := `grep -rhoE 'TRIVY_VERSION:[[:space:]]*[0-9.]+' .github/workflows | head -1 | grep -oE '[0-9.]+'`
helm_version          := `grep -rhoE 'HELM_VERSION:[[:space:]]*[0-9.]+' .github/workflows | head -1 | grep -oE '[0-9.]+'`
kubeconform_version   := `grep -rhoE 'KUBECONFORM_VERSION:[[:space:]]*[0-9.]+' .github/workflows | head -1 | grep -oE '[0-9.]+'`
kubelinter_version    := `grep -rhoE 'KUBE_LINTER_VERSION:[[:space:]]*[0-9.]+' .github/workflows | head -1 | grep -oE '[0-9.]+'`
node_major            := `grep -ohE 'node-version: [0-9]+' .github/workflows/ci.yml | head -1 | awk '{print $2}'`

[private]
default:
    @just --list --list-heading $'Local CI - see `just doctor` first\n'

[private]
_out:
    @mkdir -p "{{out}}"

# =========================================================================================
# setup
# =========================================================================================

# Homebrew for everything in the Brewfile; whatever it can't cover - currently plumber, whose
# tap Homebrew won't load untrusted - comes from the pinned, checksum-verified download. With
# no Homebrew at all (the devcontainer, a Linux box) every tool comes from that same download.
# Install every CI tool and the npm dependencies, then report what you ended up with
[group('setup')]
install: _brew-if-available
    @just install-pinned missing
    npm ci
    @just doctor

[private]
_brew-if-available:
    @if command -v brew >/dev/null; then just brew-bundle; else echo "no Homebrew - every tool comes from the pinned, checksum-verified downloads instead"; fi

# Homebrew half of `just install` on its own
[group('setup')]
brew-bundle:
    @command -v brew >/dev/null || { echo "Homebrew not found - https://brew.sh (or install the Brewfile's tools by hand, then run \`just install-pinned\`)"; exit 1; }
    brew bundle --file Brewfile

# Checksum-verified downloads, exactly as the workflows install these tools. Homebrew tracks
# latest while the workflows pin an exact version, so this is how a `just doctor` drift gets
# closed - and how the whole toolchain can be installed on a machine with no Homebrew at all.
# Fetch the pinned version of one tool, or of every drifted/missing one, into .ci-tools/bin
[group('setup')]
install-pinned tool="drifted":
    #!/usr/bin/env bash
    set -euo pipefail
    mkdir -p "{{tools_bin}}"

    case "$(uname -s)" in
      Darwin) o=darwin ;;
      Linux)  o=linux ;;
      *) echo "unsupported OS: $(uname -s)" >&2; exit 1 ;;
    esac
    case "$(uname -m)" in
      arm64|aarch64) a=arm64 ;;
      x86_64|amd64)  a=amd64 ;;
      *) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;;
    esac

    # Same shape as every workflow's install step: download the asset and the release's own
    # checksum file, verify, then keep the binary. A rename to the local filename first where
    # the checksum file names the release asset, so this stays a real check rather than a
    # silently skipped one.
    fetch_verified() { # <url-base> <asset> <checksums-file> [local-name]
      local base="$1" asset="$2" sums="$3" name="${4:-$2}" tmp
      tmp="$(mktemp -d)"
      curl -fsSL -o "${tmp}/${name}" "${base}/${asset}"
      curl -fsSL -o "${tmp}/sums.txt" "${base}/${sums}"
      # to stderr: this function's stdout is the temp directory the caller captures
      ( cd "$tmp" && grep -E "[ *]${asset}\$" sums.txt | sed "s|${asset}\$|${name}|" | {{sha256}} -c - >&2 )
      echo "$tmp"
    }

    install_one() {
      case "$1" in
        actionlint)
          # actionlint's own download script, pinned to the same commit ci.yml uses, picks the
          # right asset for this OS/arch and verifies it.
          bash <(curl -fsSL "https://raw.githubusercontent.com/rhysd/actionlint/{{actionlint_script_sha}}/scripts/download-actionlint.bash") \
            "{{actionlint_version}}" "{{tools_bin}}" >/dev/null
          ;;
        gitleaks)
          local v="{{gitleaks_version}}" asset tmp
          asset="gitleaks_${v}_${o}_${a/amd64/x64}.tar.gz"
          tmp="$(fetch_verified "https://github.com/gitleaks/gitleaks/releases/download/v${v}" "$asset" "gitleaks_${v}_checksums.txt")"
          tar -xzf "${tmp}/${asset}" -C "$tmp" gitleaks
          install -m 0755 "${tmp}/gitleaks" "{{tools_bin}}/gitleaks"
          ;;
        osv-scanner)
          local v="{{osv_version}}" tmp
          tmp="$(fetch_verified "https://github.com/google/osv-scanner/releases/download/v${v}" "osv-scanner_${o}_${a}" "osv-scanner_SHA256SUMS" "osv-scanner")"
          install -m 0755 "${tmp}/osv-scanner" "{{tools_bin}}/osv-scanner"
          ;;
        syft)
          local v="{{syft_version}}" asset tmp
          asset="syft_${v}_${o}_${a}.tar.gz"
          tmp="$(fetch_verified "https://github.com/anchore/syft/releases/download/v${v}" "$asset" "syft_${v}_checksums.txt")"
          tar -xzf "${tmp}/${asset}" -C "$tmp" syft
          install -m 0755 "${tmp}/syft" "{{tools_bin}}/syft"
          ;;
        hadolint)
          local v="{{hadolint_version}}" tmp
          tmp="$(fetch_verified "https://github.com/hadolint/hadolint/releases/download/v${v}" "hadolint-${o/darwin/macos}-${a/amd64/x86_64}" "checksums.sha256" "hadolint")"
          install -m 0755 "${tmp}/hadolint" "{{tools_bin}}/hadolint"
          ;;
        trivy)
          local v="{{trivy_version}}" asset tmp os_tag arch_tag
          os_tag="$([ "$o" = darwin ] && echo macOS || echo Linux)"
          arch_tag="$([ "$a" = arm64 ] && echo ARM64 || echo 64bit)"
          asset="trivy_${v}_${os_tag}-${arch_tag}.tar.gz"
          tmp="$(fetch_verified "https://github.com/aquasecurity/trivy/releases/download/v${v}" "$asset" "trivy_${v}_checksums.txt")"
          tar -xzf "${tmp}/${asset}" -C "$tmp" trivy
          install -m 0755 "${tmp}/trivy" "{{tools_bin}}/trivy"
          ;;
        plumber)
          local v="{{plumber_version}}" tmp
          tmp="$(fetch_verified "https://github.com/getplumber/plumber/releases/download/v${v}" "plumber-${o}-${a}" "checksums.txt" "plumber")"
          # The action additionally verifies the binary's SLSA provenance; do the same when the
          # gh CLI is around, and say so plainly when it isn't rather than implying it happened.
          if command -v gh >/dev/null; then
            gh attestation verify "${tmp}/plumber" --repo getplumber/plumber >/dev/null
          else
            echo "note: gh CLI absent - checksum verified, SLSA attestation not (the action verifies both)"
          fi
          install -m 0755 "${tmp}/plumber" "{{tools_bin}}/plumber"
          ;;
        zizmor|semgrep)
          # Both are Python packages, so uv pins them exactly without a per-platform asset table.
          command -v uv >/dev/null || { echo "uv not installed (brew install uv)" >&2; exit 1; }
          local v; [ "$1" = zizmor ] && v="{{zizmor_version}}" || v="{{semgrep_version}}"
          UV_TOOL_DIR="{{tools_dir}}/uv" UV_TOOL_BIN_DIR="{{tools_bin}}" \
            uv tool install --force "$1==${v}" >/dev/null
          ;;
        helm)
          # get.helm.sh, not GitHub releases, and a per-asset .sha256sum that already names
          # the asset - so fetch_verified needs no rename. The tarball unpacks into an
          # <os>-<arch>/ directory rather than dropping the binary at the root.
          local v="{{helm_version}}" asset tmp
          asset="helm-v${v}-${o}-${a}.tar.gz"
          tmp="$(fetch_verified "https://get.helm.sh" "$asset" "${asset}.sha256sum")"
          tar -xzf "${tmp}/${asset}" -C "$tmp" "${o}-${a}/helm"
          install -m 0755 "${tmp}/${o}-${a}/helm" "{{tools_bin}}/helm"
          ;;
        kubeconform)
          local v="{{kubeconform_version}}" asset tmp
          asset="kubeconform-${o}-${a}.tar.gz"
          tmp="$(fetch_verified "https://github.com/yannh/kubeconform/releases/download/v${v}" "$asset" "CHECKSUMS")"
          tar -xzf "${tmp}/${asset}" -C "$tmp" kubeconform
          install -m 0755 "${tmp}/kubeconform" "{{tools_bin}}/kubeconform"
          ;;
        kube-linter)
          # The one tool here with no checksums file in its release - only Sigstore bundles,
          # and those are bare blob signatures rather than provenance, so `gh attestation
          # verify` can't read them. GitHub's release API reports each asset's sha256, which
          # is the same trust root a checksums.txt would have had, so that is what this
          # checks; ci.yml does exactly the same.
          local v="{{kubelinter_version}}" tag asset digest tmp
          command -v gh >/dev/null || { echo "kube-linter needs the gh CLI to read its release digest" >&2; exit 1; }
          tag="v${v}"
          asset="kube-linter-${o}"
          [ "$a" = arm64 ] && asset="${asset}_arm64"
          digest="$(gh api "repos/stackrox/kube-linter/releases/tags/${tag}" --jq ".assets[] | select(.name == \"${asset}\") | .digest")"
          [ -n "$digest" ] || { echo "no digest reported for ${asset}" >&2; exit 1; }
          tmp="$(mktemp -d)"
          curl -fsSL -o "${tmp}/kube-linter" "https://github.com/stackrox/kube-linter/releases/download/${tag}/${asset}"
          echo "${digest#sha256:}  ${tmp}/kube-linter" | {{sha256}} -c - >/dev/null
          install -m 0755 "${tmp}/kube-linter" "{{tools_bin}}/kube-linter"
          ;;
        *) echo "unknown tool: $1 (actionlint gitleaks zizmor plumber syft osv-scanner semgrep hadolint trivy helm kubeconform kube-linter)" >&2; exit 1 ;;
      esac
      echo "  pinned $1 -> {{tools_bin}}"
    }

    case "{{tool}}" in
      drifted|missing)
        targets=()
        while IFS= read -r line; do [ -n "$line" ] && targets+=("$line"); done \
          < <("{{just_executable()}}" _drifted "--{{tool}}-only")
        if [ "${#targets[@]}" -eq 0 ]; then echo "nothing to install: every tool is present at the version its workflow pins"; exit 0; fi
        echo "installing: ${targets[*]}"
        ;;
      *) targets=("{{tool}}") ;;
    esac
    for t in "${targets[@]}"; do install_one "$t"; done

# Names of the tools that are missing or off the pinned version, one per line
[private]
_drifted flags="--drifted-only":
    @just doctor {{flags}} || true

# Report every tool the workflows need: installed or not, and at the pinned version or not
[group('setup')]
doctor *flags:
    #!/usr/bin/env bash
    set -uo pipefail
    # --drifted-only / --missing-only print bare tool names for `just install-pinned` to consume.
    quiet=""
    case "{{flags}}" in
      --drifted-only) quiet=all ;;
      --missing-only) quiet=missing ;;
      "") ;;
      *) echo "unknown flag: {{flags}}" >&2; exit 2 ;;
    esac

    # tool | pinned version | command printing the installed version
    rows=(
      "actionlint|{{actionlint_version}}|actionlint --version | head -1"
      "gitleaks|{{gitleaks_version}}|gitleaks version"
      "zizmor|{{zizmor_version}}|zizmor --version | awk '{print \$2}'"
      "plumber|{{plumber_version}}|plumber version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1"
      "syft|{{syft_version}}|syft version | awk '/^Version:/ {print \$2}'"
      "osv-scanner|{{osv_version}}|osv-scanner --version | head -1 | awk '{print \$NF}'"
      "semgrep|{{semgrep_version}}|semgrep --version"
      "hadolint|{{hadolint_version}}|hadolint --version | awk '{print \$NF}'"
      "trivy|{{trivy_version}}|trivy --version | head -1 | awk '{print \$2}'"
      "helm|{{helm_version}}|helm version --short | sed 's/^v//; s/+.*//'"
      "kubeconform|{{kubeconform_version}}|kubeconform -v | tr -d v"
      "kube-linter|{{kubelinter_version}}|kube-linter version"
    )

    missing=(); drifted=()
    [ -n "$quiet" ] || printf '%-14s %-12s %-12s %s\n' TOOL PINNED INSTALLED ''
    for row in "${rows[@]}"; do
      IFS='|' read -r name pinned cmd <<<"$row"
      if ! command -v "$name" >/dev/null; then
        missing+=("$name")
        [ -n "$quiet" ] && echo "$name"
        [ -n "$quiet" ] || printf '%-14s %-12s %-12s %s\n' "$name" "$pinned" "-" "missing"
        continue
      fi
      have="$(eval "$cmd" 2>/dev/null | tr -d ' \r')"
      if [ "$have" = "$pinned" ]; then
        [ -n "$quiet" ] || printf '%-14s %-12s %-12s %s\n' "$name" "$pinned" "$have" "ok"
      else
        drifted+=("$name")
        [ "$quiet" = all ] && echo "$name"
        [ -n "$quiet" ] || printf '%-14s %-12s %-12s %s\n' "$name" "$pinned" "${have:-?}" "drifted"
      fi
    done
    [ -n "$quiet" ] && exit 0

    # Everything else the recipes lean on but no workflow pins.
    echo
    for name in node npm podman jq python3 curl git uv gh; do
      if command -v "$name" >/dev/null; then
        printf '%-14s %s\n' "$name" "$($name --version 2>&1 | head -1)"
      else
        printf '%-14s %s\n' "$name" "missing"
      fi
    done

    echo
    node_have="$(node --version 2>/dev/null | tr -d v | cut -d. -f1)"
    [ -n "$node_have" ] && [ "$node_have" != "{{node_major}}" ] && \
      echo "note: workflows run node {{node_major}}, this shell has node ${node_have}"
    [ "${#missing[@]}" -gt 0 ] && echo "missing: ${missing[*]} - run \`just install\`"
    [ "${#drifted[@]}" -gt 0 ] && echo "drifted: ${drifted[*]} - Homebrew tracks latest; \`just install-pinned\` fetches the pinned build into {{tools_bin}}"
    [ "${#missing[@]}" -eq 0 ] && [ "${#drifted[@]}" -eq 0 ] && echo "every pinned tool is installed at the version its workflow pins"
    # Drift is a note, not a failure - a newer scanner locally is usually fine. Missing is not.
    [ "${#missing[@]}" -eq 0 ]

# =========================================================================================
# ci.yml
# =========================================================================================

# Everything ci.yml runs, each job reported pass/fail (see `just install` first)
[group('ci')]
ci: (_run "lint build size coverage schemas markdown links audit actionlint gitleaks zizmor plumber helm")

# ci.yml test job: oxlint (human-readable, then SARIF)
[group('ci')]
lint: _out
    npx oxlint
    npx oxlint --format=sarif > "{{out}}/oxlint-results.sarif"

# oxlint --fix - not a CI step, just the obvious companion to `just lint`
[group('ci')]
fix:
    npx oxlint --fix

# ci.yml test job: tsc -b && vite build
[group('ci')]
build:
    npm run build

# ci.yml test job: size-limit against dist/ (.size-limit.json)
[group('ci')]
size:
    @test -d dist || { echo "no dist/ - run \`just build\` first"; exit 1; }
    npm run lint:size

# ci.yml test job: vitest with coverage (report in coverage/index.html)
[group('ci')]
coverage:
    npm run test:coverage

# ci.yml schemas job: validate every *.schema.json against the draft 2020-12 meta-schema
[group('ci')]
schemas:
    npm run lint:schemas

# ci.yml markdown job: markdownlint-cli2 (writes its own SARIF, see .markdownlint-cli2.jsonc)
[group('ci')]
markdown: _out
    #!/usr/bin/env bash
    set -uo pipefail
    npm run lint:md; status=$?
    # The SARIF is written whether or not the lint passed - keep it either way, same as the
    # workflow's continue-on-error + upload + explicit fail.
    [ -f markdownlint-results.sarif ] && mv markdownlint-results.sarif "{{out}}/"
    exit $status

# ci.yml markdown job: check every relative + external link in every *.md (network)
[group('ci')]
links:
    npm run lint:links

# ci.yml audit job
# ci.yml helm job: lint charts/, render them, and check every manifest.
[group('ci')]
helm: _out
    #!/usr/bin/env bash
    set -euo pipefail
    # Rendering is what matters: helm lint alone would pass a Deployment with a misspelled
    # field. Each values file under charts/*/ci/ is rendered too, since the optional
    # templates (Ingress, HPA, PDB, NetworkPolicy) are off in the defaults.
    for chart in charts/*/; do
      helm lint "$chart"
      for values in "$chart"ci/*-values.yaml; do
        [ -e "$values" ] || continue
        helm lint "$chart" --values "$values"
      done
    done
    for chart in charts/*/; do
      helm template release "$chart" | kubeconform -strict -summary -kubernetes-version 1.31.0
      for values in "$chart"ci/*-values.yaml; do
        [ -e "$values" ] || continue
        echo "$(basename "$values"):"
        helm template release "$chart" --values "$values" \
          | kubeconform -strict -summary -kubernetes-version 1.31.0
      done
    done
    # kubeconform says whether the object is valid; kube-linter says whether it is sensible.
    # Config and the two documented exclusions are in .kube-linter.yaml.
    kube-linter lint charts/ --format sarif > "{{out}}/kube-linter-results.sarif" || true
    kube-linter lint charts/
    for chart in charts/*/; do
      for values in "$chart"ci/*-values.yaml; do
        [ -e "$values" ] || continue
        echo "kube-linter $(basename "$values"):"
        helm template release "$chart" --values "$values" | kube-linter lint -
      done
    done

# Manual: load-test the chart against a live cluster (see docs/helm-chart.md).
[group('container')]
loadtest *args:
    #!/usr/bin/env bash
    set -euo pipefail
    # Not part of `just ci` - it needs a cluster and several minutes. It also needs an image
    # the cluster can pull: with kind that is `just image-build` plus
    # `kind load image-archive .ci-out/image-docker.tar --name <cluster>`.
    #
    # No arguments runs the sweep behind the numbers in docs/helm-chart.md; arguments are
    # passed straight through (label, cpu-request, cpu-limit|none, mem-limit, connections,
    # seconds, path).
    kubectl cluster-info >/dev/null 2>&1 || { echo "no reachable cluster - kubectl cluster-info fails" >&2; exit 1; }
    if [ -n "{{args}}" ]; then
      scripts/helm-loadtest.sh {{args}}
      exit 0
    fi
    # The bundle is what every page load actually fetches, so it - not the 484-byte index -
    # is the workload the memory floor has to survive.
    asset="$(kubectl run loadtest-asset-$RANDOM --rm -i --restart=Never --quiet \
      --image=docker.io/curlimages/curl:latest --command -- \
      sh -c 'curl -fsS http://load-yaml-config-generator-validator.load/ | grep -o "assets/[^\"]*\.js" | head -1' 2>/dev/null | tr -d '\r' || true)"
    asset="${asset:-}"
    echo "== memory floor, 100 connections on ${asset:-/} =="
    for m in 32Mi 64Mi 128Mi; do
      scripts/helm-loadtest.sh "mem-$m" 10m none "$m" 100 15 "/${asset}"
    done
    echo "== cpu, 16 connections on ${asset:-/} =="
    for c in none 250m 100m 50m 20m; do
      scripts/helm-loadtest.sh "cpu-$c" 10m "$c" 128Mi 16 15 "/${asset}"
    done

[group('ci')]
audit:
    npm audit --audit-level=high

# ci.yml actionlint job
[group('ci')]
actionlint:
    actionlint -color

# ci.yml gitleaks job: secret scanning over the working tree
[group('ci')]
gitleaks: _out
    #!/usr/bin/env bash
    set -uo pipefail
    gitleaks detect --source . --report-format=sarif --report-path="{{out}}/gitleaks-results.sarif"

# ci.yml zizmor job: GitHub Actions security linter
[group('ci')]
zizmor: _out
    #!/usr/bin/env bash
    set -uo pipefail
    # The workflow passes GITHUB_TOKEN so the online audits (impostor commits, known-vulnerable
    # actions) can run; reuse the gh CLI's token locally, and say so when there isn't one -
    # a tokenless run silently skips those audits, which is a weaker check, not an equal one.
    token="${GH_TOKEN:-$(gh auth token 2>/dev/null || true)}"
    [ -n "$token" ] || echo "note: no GitHub token (gh auth login) - zizmor's online audits will be skipped"
    GH_TOKEN="$token" zizmor .; status=$?
    GH_TOKEN="$token" zizmor . --format=sarif > "{{out}}/zizmor-results.sarif" || true
    exit $status

# ci.yml plumber job: second, independent GitHub Actions security scanner
[group('ci')]
plumber: _out
    #!/usr/bin/env bash
    set -uo pipefail
    # Same defaults the action uses with no `with:` block - the score gate (min-points 100:
    # any finding fails) is the CLI's own default, so nothing is passed for it here either.
    plumber analyze \
      --sarif "{{out}}/plumber.sarif" \
      --output "{{out}}/plumber-report.json" \
      --pbom "{{out}}/plumber-pbom.json" \
      --pbom-cyclonedx "{{out}}/plumber-cyclonedx-sbom.json"

# =========================================================================================
# supply-chain.yml
# =========================================================================================

# Everything supply-chain.yml runs that isn't runner-only (no Sigstore attestation locally)
[group('supply-chain')]
supply-chain: (_run "sbom osv-sbom osv-source semgrep")

# supply-chain.yml sbom job: CycloneDX SBOM of the npm tree + this repo's own actions
[group('supply-chain')]
sbom: _out
    #!/usr/bin/env bash
    set -euo pipefail
    # Identical env to the workflow - these are Syft's own config vars, read however it's run.
    # The workflow additionally attests the SBOM and dist/ through Sigstore on push to main;
    # that needs the runner's OIDC identity and has no local equivalent.
    SYFT_CHECK_FOR_APP_UPDATE=false \
    SYFT_JAVASCRIPT_INCLUDE_DEV_DEPENDENCIES=true \
    SYFT_EXCLUDE='./node_modules/**/.github/**,./dist/**' \
    SYFT_SELECT_CATALOGERS='-go-module-binary-cataloger,-file-metadata-cataloger,-file-digest-cataloger' \
      syft scan dir:. -o cyclonedx-json > "{{out}}/sbom.cdx.json"

# supply-chain.yml sca-sbom job: OSV-Scanner over the SBOM (run `just sbom` first)
[group('supply-chain')]
osv-sbom: _out
    @test -f "{{out}}/sbom.cdx.json" || { echo "no SBOM - run \`just sbom\` first"; exit 1; }
    osv-scanner scan source --lockfile="./{{out}}/sbom.cdx.json" \
      --format=sarif --output-file="{{out}}/osv-results-sbom.sarif" --verbosity=error

# supply-chain.yml sca-source job: OSV-Scanner over the lockfile/source directly
[group('supply-chain')]
osv-source: _out
    osv-scanner scan source --recursive --experimental-exclude=./node_modules,./dist . \
      --format=sarif --output-file="{{out}}/osv-results-source.sarif" --verbosity=error

# supply-chain.yml sast job: Semgrep OSS, the same four public rulesets
[group('supply-chain')]
semgrep: _out
    #!/usr/bin/env bash
    set -euo pipefail
    # The workflow runs the digest-pinned semgrep/semgrep container; locally that's whatever
    # Homebrew installed, or an exactly-pinned uv-managed copy when semgrep isn't installed.
    if command -v semgrep >/dev/null; then run=(semgrep); else run=(uvx "semgrep@{{semgrep_version}}"); fi
    "${run[@]}" scan \
      --config=p/security-audit \
      --config=p/owasp-top-ten \
      --config=p/typescript \
      --config=p/react \
      --exclude=node_modules --exclude=dist \
      --metrics=off \
      --sarif --output="{{out}}/semgrep-results.sarif"

# =========================================================================================
# container.yml
# =========================================================================================

# Everything container.yml runs bar the GHCR publish (which is main-only and needs a registry)
[group('container')]
container: (_run "hadolint image-build image-smoke image-scan image-sca")

# container.yml hadolint job: lint both Containerfiles and the devcontainer's Dockerfile
[group('container')]
hadolint: _out
    #!/usr/bin/env bash
    set -uo pipefail
    files=(Containerfile Containerfile.redhat .devcontainer/Dockerfile)
    hadolint "${files[@]}"; status=$?
    hadolint --format sarif "${files[@]}" > "{{out}}/hadolint-results.sarif" || true
    exit $status

# container.yml build job: build the image, then export the archives the scanners read.
# `just image-build redhat` builds Containerfile.redhat instead (docs/container.md). Both
# land on the same local tag and the same archives, so image-smoke/scan/sca read whichever
# was built last - one variant at a time, as the workflow's matrix legs are.
[group('container')]
image-build variant="alpine": _out
    #!/usr/bin/env bash
    set -euo pipefail
    case "{{variant}}" in
      alpine) containerfile=Containerfile ;;
      redhat) containerfile=Containerfile.redhat ;;
      *) echo "unknown variant: {{variant}} (alpine redhat)" >&2; exit 1 ;;
    esac
    # buildah on the runner, podman here - the Containerfile sticks to plain OCI instructions
    # precisely so both produce the same image (docs/container.md). The GHCR layer cache and
    # --pull=always are runner concerns and deliberately left out; the commit-derived
    # timestamps are kept, so two builds of one commit still differ only by real content.
    #
    # This builds the working tree, not the commit: uncommitted changes are included, while
    # the timestamps come from HEAD.
    epoch="$(git log -1 --format=%ct)"
    podman build \
      --file "$containerfile" \
      --format oci \
      --timestamp "$epoch" \
      --layers \
      --build-arg IMAGE_CREATED="$(TZ=UTC0 git log -1 --format=%cd --date=format:%Y-%m-%dT%H:%M:%SZ)" \
      --build-arg IMAGE_REVISION="$(git rev-parse HEAD)" \
      --build-arg IMAGE_VERSION="$(git rev-parse --abbrev-ref HEAD)-$(git rev-parse --short=7 HEAD)" \
      --tag "{{image}}" \
      .
    # Two formats of one image, exactly as the workflow hands them between jobs: OCI is what
    # would be pushed, Docker-format is what Trivy and OSV-Scanner can actually read
    # ("file manifest.json not found in tar" otherwise).
    # Removed first: a workflow run always writes these fresh, but locally they're already
    # there from the last build, and `podman save` refuses to write over an existing archive
    # ("docker-archive doesn't support modifying existing images").
    rm -f "{{out}}/image.tar" "{{out}}/image-docker.tar"
    podman save --format oci-archive -o "{{out}}/image.tar" "{{image}}"
    podman save --format docker-archive -o "{{out}}/image-docker.tar" "{{image}}"
    SYFT_CHECK_FOR_APP_UPDATE=false syft scan "oci-archive:{{out}}/image.tar" -o cyclonedx-json > "{{out}}/image-sbom.cdx.json"

# container.yml build job: run the image locked down and assert it actually serves the app.
# Pass the variant you built - it only changes which UID is expected.
[group('container')]
image-smoke variant="alpine":
    #!/usr/bin/env bash
    set -euo pipefail
    case "{{variant}}" in
      alpine) expected_user=101:101 ;;
      redhat) expected_user=65532:0 ;;
      *) echo "unknown variant: {{variant}} (alpine redhat)" >&2; exit 1 ;;
    esac
    trap 'podman logs smoke 2>&1 | tail -20 || true; podman rm -f smoke >/dev/null 2>&1 || true' EXIT

    podman rm -f smoke >/dev/null 2>&1 || true
    podman run -d --name smoke -p 8080:8080 \
      --read-only --tmpfs /tmp \
      --cap-drop=ALL --security-opt=no-new-privileges \
      "{{image}}" >/dev/null

    for _ in $(seq 1 30); do
      curl -fsS http://localhost:8080/healthz >/dev/null 2>&1 && break
      sleep 1
    done

    curl -fsS http://localhost:8080/healthz | grep -qx ok
    curl -fsS http://localhost:8080/ | grep -q '<div id="root">'          # the SPA, not nginx's default page
    curl -fsS http://localhost:8080/does-not-exist | grep -q '<div id="root">'  # SPA fallback, not a 404

    headers="$(curl -fsSI http://localhost:8080/)"
    grep -qi '^content-security-policy:' <<<"$headers"
    grep -qi '^x-content-type-options: nosniff' <<<"$headers"
    grep -qi '^referrer-policy:' <<<"$headers"
    if grep -qiE '^server: nginx/' <<<"$headers"; then
      echo "nginx version leaked in Server header" >&2; exit 1
    fi
    # Not `podman exec smoke id -u`: the Red Hat runtime image is distroless, with no shell
    # and no coreutils to exec. The declared identity comes from the image config, and podman
    # top's `user` descriptor (read from the host) proves the live process isn't root - see
    # the same pair in container.yml's smoke step for why it can't be one numeric check.
    test "$(podman inspect smoke | jq -r '.[0].Config.User')" = "$expected_user"
    top_users="$(podman top smoke user | tail -n +2 | sort -u)"
    test -n "$top_users"
    if grep -qxE 'root|0' <<<"$top_users"; then
      echo "container process is running as root: $top_users" >&2; exit 1
    fi
    echo "smoke test passed ({{variant}}, user $expected_user)"

# container.yml scan job: Trivy over the image (report, then the fixable HIGH/CRITICAL gate)
[group('container')]
image-scan: _out
    #!/usr/bin/env bash
    set -euo pipefail
    test -f "{{out}}/image-docker.tar" || { echo "no image archive - run \`just image-build\` first" >&2; exit 1; }
    trivy image --input "{{out}}/image-docker.tar" \
      --scanners vuln,secret,misconfig \
      --format sarif --output "{{out}}/trivy-results.sarif"
    # Two passes over the same cached DB, as in the workflow: the SARIF above reports
    # everything, this one is the gate.
    trivy image --input "{{out}}/image-docker.tar" \
      --scanners vuln,secret \
      --severity HIGH,CRITICAL \
      --ignore-unfixed \
      --exit-code 1

# container.yml sca job: OSV-Scanner over the image (not its SBOM - see docs/container.md)
[group('container')]
image-sca: _out
    #!/usr/bin/env bash
    set -euo pipefail
    test -f "{{out}}/image-docker.tar" || { echo "no image archive - run \`just image-build\` first" >&2; exit 1; }
    osv-scanner scan image --archive "{{out}}/image-docker.tar" \
      --format sarif --output-file "{{out}}/osv-results-container.sarif" \
      --verbosity error || true
    test -s "{{out}}/osv-results-container.sarif"
    osv-scanner scan image --archive "{{out}}/image-docker.tar" \
      --format json --output-file "{{out}}/osv-results-container.json" \
      --verbosity error || true
    # Kept in step with container.yml's gate (fixable, CVSS >= 7.0 - the same bar Trivy's
    # --severity HIGH,CRITICAL --ignore-unfixed applies). Duplicated rather than shared as a
    # script file because that job downloads artifacts without checking the repo out, so it
    # has no file to call - change one, change the other.
    python3 - "{{out}}/osv-results-container.json" <<'PY'
    import json, sys

    with open(sys.argv[1]) as handle:
        report = json.load(handle)

    blocking = []
    reported = 0
    for result in report.get('results', []):
        for package in result.get('packages', []):
            severity_by_id = {
                vuln_id: float(group['max_severity'])
                for group in package.get('groups', [])
                if group.get('max_severity')
                for vuln_id in group.get('ids', [])
            }
            for vuln in package.get('vulnerabilities', []):
                reported += 1
                severity = severity_by_id.get(vuln['id'], 0.0)
                fixed = any(
                    'fixed' in event
                    for affected in vuln.get('affected', [])
                    for range_ in affected.get('ranges', [])
                    for event in range_.get('events', [])
                )
                if severity >= 7.0 and fixed:
                    name = package['package']['name']
                    version = package['package']['version']
                    blocking.append(f"{vuln['id']} {name} {version} (CVSS {severity})")

    for finding in sorted(set(blocking)):
        print(finding)
    print(f'{reported} vulnerabilities reported, {len(set(blocking))} of them fixable HIGH/CRITICAL')
    sys.exit(1 if blocking else 0)
    PY

# Serve the built image the way docs/container.md tells people to run it (Ctrl-C to stop)
[group('container')]
image-run:
    podman run --rm -p 8080:8080 \
      --read-only --tmpfs /tmp \
      --cap-drop=ALL --security-opt=no-new-privileges \
      "{{image}}"

# =========================================================================================
# everything / artifacts / housekeeping
# =========================================================================================

# ci + supply-chain + container
[group('ci')]
all: (_run "ci supply-chain container")

# Vite dev server
[group('dev')]
dev:
    npm run dev

# vitest, no coverage
[group('dev')]
test *args:
    npx vitest run {{args}}

# vitest in watch mode
[group('dev')]
watch:
    npx vitest

# Serve the built dist/ locally
[group('dev')]
preview:
    npm run preview

# What the last run produced in .ci-out, with the finding count of each SARIF report
[group('artifacts')]
artifacts:
    #!/usr/bin/env bash
    set -uo pipefail
    [ -d "{{out}}" ] || { echo "nothing yet - run \`just ci\`"; exit 0; }
    for f in "{{out}}"/*; do
      [ -e "$f" ] || continue
      size="$(du -h "$f" | cut -f1 | tr -d ' ')"
      case "$f" in
        *.sarif)
          n="$(jq '[.runs[].results[]] | length' "$f" 2>/dev/null || echo '?')"
          printf '%-46s %6s  %s findings\n' "$f" "$size" "$n" ;;
        *.cdx.json)
          n="$(jq '.components | length' "$f" 2>/dev/null || echo '?')"
          printf '%-46s %6s  %s components\n' "$f" "$size" "$n" ;;
        *)
          printf '%-46s %6s\n' "$f" "$size" ;;
      esac
    done
    [ -f coverage/index.html ] && printf '%-46s %6s  open it in a browser\n' coverage/index.html "$(du -h coverage/index.html | cut -f1 | tr -d ' ')"
    true

# Delete the reports, the build output and the smoke-test container image
[group('artifacts')]
clean:
    rm -rf "{{out}}" dist coverage markdownlint-results.sarif
    -podman rmi -f "{{image}}" 2>/dev/null

# Delete the exact-pinned tools in .ci-tools (Homebrew's copies are untouched)
[group('setup')]
clean-tools:
    rm -rf "{{tools_root}}"

# Run several recipes in sequence, reporting each - CI shows every failing job, not just the first
[private]
_run +recipes:
    #!/usr/bin/env bash
    set -uo pipefail
    failed=()
    for recipe in {{recipes}}; do
      printf '\n\033[1m==> just %s\033[0m\n' "$recipe"
      "{{just_executable()}}" "$recipe" || failed+=("$recipe")
    done
    echo
    if [ "${#failed[@]}" -gt 0 ]; then
      printf '\033[31mfailed: %s\033[0m\n' "${failed[*]}"
      exit 1
    fi
    printf '\033[32mall passed: %s\033[0m\n' "{{recipes}}"
