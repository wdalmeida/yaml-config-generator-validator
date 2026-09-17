// Command scan-gate reads a container scanner's JSON report and fails when it contains a
// fixable HIGH/CRITICAL finding.
//
//	go run ./tools/cmd/scan-gate trivy <report.json>
//	go run ./tools/cmd/scan-gate osv   <report.json>
//
// Exit codes are the entire contract:
//
//	0  nothing blocking (or, for `trivy`, a scan that enumerated nothing - see below)
//	1  at least one fixable HIGH/CRITICAL finding
//	2  the report could not be read at all
//
// This command exists because the OSV half of it used to be ~35 lines of Python written out
// twice: once inline in container.yml's `sca` job and once again in the justfile's `image-sca`
// recipe, with a comment on each copy saying "change one, change the other". The workflow job
// downloads an image artifact without checking the repo out, so it had no script file to call.
// It now does a *sparse* checkout of the Go module beside its acceptance file, which is what
// collapses the duplication - the workflow and the justfile run byte-identical commands.
//
// The `trivy` mode additionally reports what the scan could see. A scanner that cannot
// identify the image's OS reports nothing and exits 0, which is indistinguishable in a check
// list from a clean image - Trivy 0.74.0 reads Project Hummingbird's Red Hat image as OS family
// "none" with zero packages. That is a scanner gap, not a clean image, so the run says it out
// loud as a workflow warning rather than passing quietly. See docs/container.md.
package main

import (
	"fmt"
	"io"
	"os"

	"github.com/wdalmeida/yaml-config-generator-validator/tools/internal/scan"
)

const usage = `usage: scan-gate (trivy|osv) <report.json>`

func main() {
	os.Exit(run(os.Args[1:], os.Stdout))
}

func run(args []string, stdout io.Writer) int {
	if len(args) != 2 {
		fmt.Fprintln(os.Stderr, usage)
		return 2
	}
	engine, path := args[0], args[1]

	file, err := os.Open(path)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 2
	}
	defer file.Close()

	var report scan.Report
	switch engine {
	case "trivy":
		report, err = scan.ReadTrivy(file)
	case "osv":
		report, err = scan.ReadOSV(file)
	default:
		fmt.Fprintln(os.Stderr, usage)
		return 2
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 2
	}

	if engine == "trivy" {
		fmt.Fprintf(stdout, "OS family: %s; OS packages enumerated: %d\n", report.OSFamily, report.Packages)
		if report.OSFamily == "none" || report.Packages == 0 {
			fmt.Fprintf(stdout,
				"::warning title=Vulnerability scan enumerated no packages::Trivy read this image as "+
					"OS family %q and found %d packages to check, so a passing scan says nothing about "+
					"it. See docs/container.md.\n", report.OSFamily, report.Packages)
		}
	}

	for _, finding := range report.Blocking {
		fmt.Fprintln(stdout, finding)
	}
	fmt.Fprintf(stdout, "%d findings reported, %d of them fixable HIGH/CRITICAL\n",
		report.Reported, len(report.Blocking))

	if len(report.Blocking) > 0 {
		return 1
	}
	return 0
}
