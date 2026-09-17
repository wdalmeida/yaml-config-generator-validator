#!/usr/bin/env bash
# Checks the links in every Markdown file in the repo. markdown-link-check only handles one file
# per invocation and `find -exec` doesn't propagate a failing exit code back out, so this loop
# does it explicitly.
#
# The config file decides WHICH links get checked, and the two are run at different times for a
# reason:
#
#   .markdown-link-check.json           relative links only (ignorePatterns drops http(s)).
#                                       Filesystem-only, so it is instant, offline and
#                                       deterministic - and it is the half a pull request can
#                                       actually break, by moving a file something links to.
#                                       Runs on every PR (ci.yml's `links` job).
#   .markdown-link-check.external.json  every link, including external URLs. Slow and network
#                                       -dependent - ~40 URLs, most of them github.com, which
#                                       rate-limits unauthenticated runners (hence retryOn429).
#                                       It fails for reasons that have nothing to do with the
#                                       commit, so it runs weekly instead (link-check.yml).
set -uo pipefail

config=${1:-.markdown-link-check.json}

status=0
while IFS= read -r -d '' file; do
  echo "Checking $file"
  npx markdown-link-check -q -c "$config" "$file" || status=1
done < <(find . -name '*.md' -not -path './node_modules/*' -not -path './.ci-tools/*' -print0)

exit $status
