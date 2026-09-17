package main

import (
	"bytes"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// fixtures live with the parser they were captured for; see that directory's README for how.
func fixture(name string) string {
	return filepath.Join("..", "..", "internal", "scan", "testdata", name)
}

// The exit codes ARE the contract - they are what container.yml's scan and sca jobs read, and
// nothing else about this command's output changes whether a build is red.
func TestExitCodes(t *testing.T) {
	tests := []struct {
		name string
		args []string
		want int
	}{
		{"trivy, a fixable HIGH", []string{"trivy", fixture("trivy-alpine.json")}, 1},
		{"trivy, the same finding unfixable", []string{"trivy", fixture("trivy-alpine-unfixed.json")}, 0},
		{"trivy, the same finding accepted", []string{"trivy", fixture("trivy-alpine-accepted.json")}, 0},
		{"trivy, a CRITICAL secret", []string{"trivy", fixture("trivy-secret.json")}, 1},
		{"trivy, nothing enumerated", []string{"trivy", fixture("trivy-no-packages.json")}, 0},
		{"osv, a fixable CVSS 8.1", []string{"osv", fixture("osv-alpine.json")}, 1},
		{"osv, the same finding unfixable", []string{"osv", fixture("osv-alpine-unfixed.json")}, 0},
		{"osv, the same finding accepted", []string{"osv", fixture("osv-alpine-accepted.json")}, 0},
		{"a missing report", []string{"osv", fixture("nope.json")}, 2},
		{"an unknown engine", []string{"grype", fixture("osv-alpine.json")}, 2},
		{"no arguments", nil, 2},
		{"too many arguments", []string{"osv", "a", "b"}, 2},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var out bytes.Buffer
			if got := run(test.args, &out); got != test.want {
				t.Errorf("exit code = %d, want %d\noutput:\n%s", got, test.want, out.String())
			}
		})
	}
}

// A failing gate has to name what it failed on: a red build whose log says only "failed" costs
// somebody a local re-run to find out which CVE it was.
func TestAFailingGateNamesTheFinding(t *testing.T) {
	var out bytes.Buffer
	run([]string{"osv", fixture("osv-alpine.json")}, &out)

	for _, want := range []string{"ALPINE-CVE-2026-40200", "musl", "CVSS 8.1", "1 of them fixable HIGH/CRITICAL"} {
		if !strings.Contains(out.String(), want) {
			t.Errorf("output does not mention %q:\n%s", want, out.String())
		}
	}
}

// A scan that enumerated nothing exits 0, because there is nothing to gate on - so the only
// thing standing between that and a check list indistinguishable from a clean image is this
// warning. docs/container.md is the long version.
func TestAScanThatSawNothingWarnsInsteadOfPassingQuietly(t *testing.T) {
	var out bytes.Buffer
	if got := run([]string{"trivy", fixture("trivy-no-packages.json")}, &out); got != 0 {
		t.Fatalf("exit code = %d, want 0", got)
	}
	if !strings.Contains(out.String(), "::warning title=Vulnerability scan enumerated no packages::") {
		t.Errorf("no workflow warning in:\n%s", out.String())
	}
	if !strings.Contains(out.String(), "OS family: none; OS packages enumerated: 0") {
		t.Errorf("no coverage line in:\n%s", out.String())
	}
}

// And the inverse: a scan that did see the image must NOT warn, or the warning is noise nobody
// reads by the third run.
func TestARealScanDoesNotWarn(t *testing.T) {
	var out bytes.Buffer
	run([]string{"trivy", fixture("trivy-alpine.json")}, &out)
	if strings.Contains(out.String(), "::warning") {
		t.Errorf("warned about a scan that enumerated 15 packages:\n%s", out.String())
	}
}

// Smoke: the command as CI and the justfile actually invoke it - a real `go run` process, with
// the real exit status, not run() called in-process. Skipped under -short since it compiles.
func TestGoRunSmoke(t *testing.T) {
	if testing.Short() {
		t.Skip("compiles a binary")
	}
	if _, err := exec.LookPath("go"); err != nil {
		t.Skip("no go toolchain on PATH")
	}

	cmd := exec.Command("go", "run", "./tools/cmd/scan-gate", "osv",
		filepath.Join("tools", "internal", "scan", "testdata", "osv-alpine.json"))
	cmd.Dir = filepath.Join("..", "..", "..")
	out, err := cmd.CombinedOutput()

	exit, ok := err.(*exec.ExitError)
	if !ok {
		t.Fatalf("expected a non-zero exit, got err=%v\n%s", err, out)
	}
	if exit.ExitCode() != 1 {
		t.Fatalf("exit code = %d, want 1\n%s", exit.ExitCode(), out)
	}
	if !strings.Contains(string(out), "ALPINE-CVE-2026-40200") {
		t.Errorf("output does not name the finding:\n%s", out)
	}
}
