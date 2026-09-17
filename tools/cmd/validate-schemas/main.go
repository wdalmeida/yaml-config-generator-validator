// Command validate-schemas runs the two passes over the JSON files this app loads at build
// time: every src/configs/schemas/*.schema.json against the real JSON Schema draft 2020-12
// meta-schema, and every src/onboarding/*.onboarding.json against our own checked-in
// meta-schema plus the semantic rules that meta-schema cannot express.
//
//	go run ./tools/cmd/validate-schemas [repo-root]
//
// The rules and why each one exists are in tools/internal/schemacheck.
package main

import (
	"fmt"
	"os"

	"github.com/wdalmeida/yaml-config-generator-validator/tools/internal/schemacheck"
)

func main() {
	root := "."
	if len(os.Args) > 1 {
		root = os.Args[1]
	}

	result, err := schemacheck.Check(root)
	for _, line := range result.Lines {
		if len(line) > 4 && line[:4] == "FAIL" {
			fmt.Fprintln(os.Stderr, line)
		} else {
			fmt.Println(line)
		}
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if result.Failed {
		os.Exit(1)
	}
}
