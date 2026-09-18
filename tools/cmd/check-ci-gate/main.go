// Command check-ci-gate asserts that every workflow fronted by an aggregate gate job still
// lists all of that file's other jobs in the gate's `needs:`.
//
//	go run ./tools/cmd/check-ci-gate [workflow.yml ...]
//
// With no arguments it checks every entry in ciok.GateFor. Each of those gates is the single
// required status check for its workflow, so a job missing from one is enforced by nothing at
// all - which is exactly how the previous per-context ruleset silently stopped covering `helm`
// and `plumber`. Exits 1 with a line per problem.
package main

import (
	"fmt"
	"os"
	"sort"

	"github.com/wdalmeida/yaml-config-generator-validator/tools/internal/ciok"
)

func main() {
	paths := os.Args[1:]
	if len(paths) == 0 {
		for path := range ciok.GateFor {
			paths = append(paths, path)
		}
		sort.Strings(paths)
	}

	failed := false
	for _, path := range paths {
		gate, ok := ciok.GateFor[path]
		if !ok {
			// An explicitly named file that is not in the map is checked against ci.yml's
			// gate, which is what the single-argument form was for before this was a set.
			gate = ciok.Gate
		}
		if !check(path, gate) {
			failed = true
		}
	}
	if failed {
		os.Exit(1)
	}
}

func check(path, gate string) bool {
	source, err := os.ReadFile(path)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return false
	}

	result, err := ciok.CheckGate(source, gate)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %s: %v\n", path, err)
		return false
	}

	for _, id := range result.Missing {
		fmt.Fprintf(os.Stderr, "error: %s: job %q is missing from %s's needs:\n", path, id, gate)
	}
	for _, id := range result.Dangling {
		fmt.Fprintf(os.Stderr, "error: %s: %s needs %q, which is not a job\n", path, gate, id)
	}
	if !result.OK() {
		return false
	}

	fmt.Printf("%-38s %s covers all %d jobs\n", path, gate, len(result.Jobs))
	return true
}
