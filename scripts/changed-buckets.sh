#!/usr/bin/env bash
# Works out which categories of file a pull request touched, so ci.yml can skip the jobs that
# cannot possibly be affected. Writes `<bucket>=true|false` lines to $GITHUB_OUTPUT (or stdout
# when run by hand).
#
# Two rules govern everything here:
#
#   1. FAIL OPEN. Every unexpected condition - a non-PR event, a missing parent, an error
#      anywhere - reports every bucket as changed, so CI over-runs rather than under-runs. A
#      skipped job reports "skipped", which ci-ok accepts, so silently skipping a job that
#      should have run is the one failure mode that lets a broken PR through.
#   2. ANY .github/** CHANGE RUNS EVERYTHING. renovate.json automerges the workflow tool-version
#      group precisely because ci.yml's own actionlint/gitleaks/zizmor/helm jobs exercise a bump.
#      A HELM_VERSION bump touches only ci.yml, so without this rule the helm job would skip and
#      the PR would automerge completely unexercised. Same for the justfile and this script.
#
# Only `pull_request` is ever gated. Pushes to main, the crons and manual runs always run the
# full suite, so a mis-defined pattern below is caught after the merge rather than never.
#
# Deliberately bash 3.2 compatible (no associative arrays): the shebang picks up whatever bash
# is first on PATH, which on a stock macOS is 3.2.
set -uo pipefail

BUCKETS='app schemas markdown links deps charts workflows'

out() { printf '%s\n' "$@" >>"${GITHUB_OUTPUT:-/dev/stdout}"; }

all_true() {
  trap - ERR # never re-enter, even if writing the output file is what failed
  local bucket
  echo "Running every job: $1"
  for bucket in ${BUCKETS}; do out "${bucket}=true"; done
  exit 0
}

# Any error at all - including an unset variable - falls back to running everything.
trap 'all_true "changed-buckets.sh failed (line ${LINENO}); failing open"' ERR

[ "${GITHUB_EVENT_NAME:-}" = 'pull_request' ] ||
  all_true "event is ${GITHUB_EVENT_NAME:-unknown}, not pull_request"

# actions/checkout leaves us on refs/pull/N/merge, whose two parents are the base tip (HEAD^1)
# and the PR head (HEAD^2) - so HEAD^1..HEAD is exactly the PR's delta, with no dependence on
# the event payload's shas having been fetched. If HEAD^2 is missing we are not on a merge ref
# (a `ref:` input or pull_request_target would do that), and HEAD^1 would silently mean "the
# previous commit on this branch" instead. Bail out rather than gate on the wrong diff.
git rev-parse --verify --quiet 'HEAD^2' >/dev/null || all_true 'HEAD is not a PR merge commit'

# --no-renames matters: with rename detection `--name-only` prints only the destination path, so
# a moved docs/img/*.svg would not show its old path - exactly the case lint:links must catch.
changed=$(git diff --name-only --no-renames 'HEAD^1' HEAD) || all_true 'git diff failed'
[ -n "${changed}" ] || all_true 'empty diff'

echo 'Changed files:'
printf '%s\n' "${changed}" | sed 's/^/  /'

# True when any changed path matches the given extended regex.
matches() { printf '%s\n' "${changed}" | grep -qE "$1"; }

if matches '^(\.github/|justfile$|scripts/changed-buckets\.sh$)'; then
  all_true 'a workflow, the justfile or this script changed'
fi

# Shared by every npm-driven job: oxlint, ajv, markdownlint-cli2 and vitest all come from here.
NPM_DEPS='^package(-lock)?\.json$'

bucket_regex() {
  case "$1" in
    app) printf '^(src/|public/|index\.html$|vite\.config\.ts$|tsconfig.*\.json$|\.oxlintrc\.json$|\.size-limit\.json$)|%s' "${NPM_DEPS}" ;;
    schemas) printf '^(src/|scripts/validate-json-schemas\.mjs$)|%s' "${NPM_DEPS}" ;;
    markdown) printf '\.md$|^\.markdownlint-cli2\.jsonc$|%s' "${NPM_DEPS}" ;;
    # Wider than "markdown" on purpose: lint:links resolves relative links that point OUT of
    # markdown - ../charts/.../ci/both-limits-values.yaml, ../scripts/helm-*.sh, LICENSE,
    # docs/capacity-report.html, docs/img/*.svg - so moving any of those breaks a link.
    links) printf '\.md$|^(\.markdown-link-check.*\.json$|scripts/|docs/|charts/|LICENSE$)|%s' "${NPM_DEPS}" ;;
    deps) printf '%s' "${NPM_DEPS}" ;;
    charts) printf '^(charts/|\.kube-linter\.yaml$)' ;;
    # Unreachable in practice - a .github/** change already triggered all_true above - but kept
    # so the mapping is complete and each job's `if:` reads honestly.
    workflows) printf '^\.github/' ;;
    *) echo "unknown bucket: $1" >&2; return 1 ;;
  esac
}

echo 'Buckets:'
for bucket in ${BUCKETS}; do
  if matches "$(bucket_regex "${bucket}")"; then value=true; else value=false; fi
  echo "  ${bucket}=${value}"
  out "${bucket}=${value}"
done
