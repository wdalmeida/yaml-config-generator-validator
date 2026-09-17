// Package scan reads the JSON two container vulnerability scanners produce and applies one
// shared bar to both: a finding blocks only if it is HIGH/CRITICAL *and* fixable.
//
// The bar is deliberately identical across engines so Trivy and OSV-Scanner fail the build for
// the same class of finding rather than one of them reddening it over an advisory nobody can
// act on. Neither reader applies a dated acceptance itself: both scanners are run with their
// own acceptance file (--ignorefile .trivyignore.yaml / --config osv-scanner.toml), which
// removes an accepted finding from the JSON before it ever reaches this package. That is what
// keeps the "this is a deadline, not a dismissal" property working - when the date passes, the
// finding comes back into the JSON and this gate fails again, with no change here.
package scan

import (
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strings"
)

// Threshold is the CVSS score at or above which a fixable finding blocks. It is the numeric
// spelling of Trivy's HIGH/CRITICAL, which is how the two engines are held to one bar:
// OSV-Scanner has no severity flag of its own, so its side is read out of max_severity.
const Threshold = 7.0

// Finding is one blocking result, formatted for the log.
type Finding struct {
	ID      string
	Package string
	Version string
	// Severity is the CVSS score where the engine reports one, and 0 for a Trivy finding whose
	// severity is a band (HIGH/CRITICAL) rather than a score.
	Severity float64
	// Band is Trivy's severity word, empty for OSV findings.
	Band string
}

func (f Finding) String() string {
	subject := strings.TrimSpace(f.Package + " " + f.Version)
	if f.Band != "" {
		return fmt.Sprintf("%s %s (%s)", f.ID, subject, f.Band)
	}
	return fmt.Sprintf("%s %s (CVSS %g)", f.ID, subject, f.Severity)
}

// Report is the outcome of reading one scanner's JSON.
type Report struct {
	// Reported is every finding the scanner listed, blocking or not.
	Reported int
	// Blocking is the deduplicated, sorted list of findings that fail the build.
	Blocking []string
	// OSFamily and Packages are Trivy coverage numbers; they are zero-valued for OSV.
	OSFamily string
	Packages int
}

// trivyReport is the subset of `trivy image --format json` this gate reads.
type trivyReport struct {
	Metadata struct {
		OS struct {
			Family string `json:"Family"`
		} `json:"OS"`
	} `json:"Metadata"`
	Results []struct {
		Packages []struct {
			Name string `json:"Name"`
		} `json:"Packages"`
		Vulnerabilities []struct {
			VulnerabilityID  string `json:"VulnerabilityID"`
			PkgName          string `json:"PkgName"`
			InstalledVersion string `json:"InstalledVersion"`
			FixedVersion     string `json:"FixedVersion"`
			Status           string `json:"Status"`
			Severity         string `json:"Severity"`
		} `json:"Vulnerabilities"`
		Secrets []struct {
			RuleID   string `json:"RuleID"`
			Title    string `json:"Title"`
			Severity string `json:"Severity"`
		} `json:"Secrets"`
	} `json:"Results"`
}

// ReadTrivy applies Trivy's own `--severity HIGH,CRITICAL --ignore-unfixed` semantics to a
// report produced without those flags, and counts what the scan could see while it is there.
//
// Two asymmetries are deliberate, because they are Trivy's:
//
//   - `--ignore-unfixed` applies to vulnerabilities only. A HIGH or CRITICAL secret has no
//     "fixed version" to have, and dropping it would quietly stop the gate failing on a
//     credential baked into the image - which is the finding you least want filtered.
//   - a vulnerability counts as fixable when it carries a FixedVersion. Trivy also reports
//     Status "fixed"/"affected"/"will_not_fix"/"fix_deferred"/"end_of_life"; FixedVersion is
//     what --ignore-unfixed actually keys on, so that is what this keys on too.
//
// Reading one report instead of running Trivy a third time is the reason this exists: the
// workflow used to invoke Trivy once for SARIF, once for the coverage count and once for the
// gate.
func ReadTrivy(r io.Reader) (Report, error) {
	var doc trivyReport
	if err := json.NewDecoder(r).Decode(&doc); err != nil {
		return Report{}, fmt.Errorf("reading Trivy report: %w", err)
	}

	report := Report{OSFamily: doc.Metadata.OS.Family}
	if report.OSFamily == "" {
		report.OSFamily = "none"
	}

	var blocking []Finding
	for _, result := range doc.Results {
		report.Packages += len(result.Packages)

		for _, vuln := range result.Vulnerabilities {
			report.Reported++
			if !isBlockingBand(vuln.Severity) || vuln.FixedVersion == "" {
				continue
			}
			blocking = append(blocking, Finding{
				ID:      vuln.VulnerabilityID,
				Package: vuln.PkgName,
				Version: vuln.InstalledVersion,
				Band:    strings.ToUpper(vuln.Severity),
			})
		}

		for _, secret := range result.Secrets {
			report.Reported++
			if !isBlockingBand(secret.Severity) {
				continue
			}
			blocking = append(blocking, Finding{
				ID:      secret.RuleID,
				Package: secret.Title,
				Band:    strings.ToUpper(secret.Severity),
			})
		}
	}

	report.Blocking = dedupe(blocking)
	return report, nil
}

func isBlockingBand(severity string) bool {
	switch strings.ToUpper(severity) {
	case "HIGH", "CRITICAL":
		return true
	default:
		return false
	}
}

func dedupe(findings []Finding) []string {
	seen := make(map[string]struct{}, len(findings))
	out := make([]string, 0, len(findings))
	for _, finding := range findings {
		line := finding.String()
		if _, ok := seen[line]; ok {
			continue
		}
		seen[line] = struct{}{}
		out = append(out, line)
	}
	sort.Strings(out)
	return out
}
