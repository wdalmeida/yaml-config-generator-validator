// Command check-ci-gate asserts that ci.yml's `ci-ok` job still lists every other job in the
// file in its `needs:`.
//
//	go run ./tools/cmd/check-ci-gate [workflow.yml]
//
// ci-ok is the only required status check for `main`, so a job missing from its `needs:` is
// enforced by nothing at all - which is exactly how the previous per-context ruleset silently
// stopped covering `helm` and `plumber`. Exits 1 with a line per problem when that happens.
package main

import (
	"fmt"
	"os"

	"github.com/wdalmeida/yaml-config-generator-validator/tools/internal/ciok"
)

const defaultWorkflow = ".github/workflows/ci.yml"

func main() {
	path := defaultWorkflow
	if len(os.Args) > 1 {
		path = os.Args[1]
	}

	source, err := os.ReadFile(path)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}

	result, err := ciok.Check(source)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %s: %v\n", path, err)
		os.Exit(1)
	}

	for _, id := range result.Missing {
		fmt.Fprintf(os.Stderr, "error: job %q is missing from %s's needs:\n", id, ciok.Gate)
	}
	for _, id := range result.Dangling {
		fmt.Fprintf(os.Stderr, "error: %s needs %q, which is not a job\n", ciok.Gate, id)
	}
	if !result.OK() {
		os.Exit(1)
	}

	fmt.Printf("%s covers all %d jobs in %s\n", ciok.Gate, len(result.Jobs), path)
}
