// Command changed-buckets works out which categories of file a pull request touched and writes
// `<bucket>=true|false` lines to $GITHUB_OUTPUT (or stdout when run by hand), so ci.yml's jobs
// can skip what a change cannot possibly affect.
//
// The rules it implements, and why each one is load-bearing, are in
// tools/internal/buckets. The short version: it fails open on every error, any .github/**
// change turns every bucket on, only `pull_request` is ever gated, and the `links` bucket is
// deliberately wider than `markdown`.
//
//	go run ./tools/cmd/changed-buckets
package main

import (
	"fmt"
	"os"

	"github.com/wdalmeida/yaml-config-generator-validator/tools/internal/buckets"
)

func main() {
	result, changed := buckets.For(os.Getenv("GITHUB_EVENT_NAME"), buckets.ExecGit{})

	if result.Reason != "" {
		fmt.Println("Running every job:", result.Reason)
	} else {
		fmt.Println("Changed files:")
		for _, path := range changed {
			fmt.Println(" ", path)
		}
	}

	fmt.Println("Buckets:")
	lines := make([]string, 0, len(buckets.Names))
	for _, name := range buckets.Names {
		line := fmt.Sprintf("%s=%t", name, result.Values[name])
		fmt.Println(" ", line)
		lines = append(lines, line)
	}

	// Failing to write the output file is itself a fail-open condition: a `changes` job that
	// reports nothing would leave every `if:` false and skip the entire suite, which is the one
	// outcome this command exists to prevent. Say so and go red instead.
	if err := writeOutput(lines); err != nil {
		fmt.Fprintln(os.Stderr, "error: could not write bucket outputs:", err)
		os.Exit(1)
	}
}

func writeOutput(lines []string) error {
	path := os.Getenv("GITHUB_OUTPUT")
	if path == "" {
		return nil // run by hand: the listing above is the output
	}

	file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	for _, line := range lines {
		if _, err := fmt.Fprintln(file, line); err != nil {
			file.Close()
			return err
		}
	}
	return file.Close()
}
