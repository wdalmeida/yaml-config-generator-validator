#!/usr/bin/env bash
# Checks every relative and external link in every Markdown file in the repo.
# markdown-link-check only handles one file per invocation and `find -exec` doesn't
# propagate a failing exit code back out, so this loop does it explicitly.
set -uo pipefail

status=0
while IFS= read -r -d '' file; do
  echo "Checking $file"
  npx markdown-link-check -q -c .markdown-link-check.json "$file" || status=1
done < <(find . -name '*.md' -not -path './node_modules/*' -print0)

exit $status
