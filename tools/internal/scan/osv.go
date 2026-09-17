package scan

import (
	"encoding/json"
	"fmt"
	"io"
	"strconv"
)

// The subset of `osv-scanner --format json` this gate reads.
type (
	osvReport struct {
		Results []osvResult `json:"results"`
	}
	osvResult struct {
		Packages []osvPackage `json:"packages"`
	}
	osvPackage struct {
		Package struct {
			Name    string `json:"name"`
			Version string `json:"version"`
		} `json:"package"`
		Groups          []osvGroup `json:"groups"`
		Vulnerabilities []osvVuln  `json:"vulnerabilities"`
	}
	osvGroup struct {
		IDs []string `json:"ids"`
		// max_severity is a *string* in OSV-Scanner's JSON ("7.5"), and it is empty for a
		// group whose advisories carry no CVSS vector at all.
		MaxSeverity string `json:"max_severity"`
	}
	osvVuln struct {
		ID       string        `json:"id"`
		Affected []osvAffected `json:"affected"`
	}
	osvAffected struct {
		Ranges []osvRange `json:"ranges"`
	}
	osvRange struct {
		Events []map[string]any `json:"events"`
	}
)

// ReadOSV holds OSV-Scanner to exactly the bar Trivy's gate uses - fixable, CVSS >= 7.0.
//
// OSV-Scanner has no severity or --ignore-unfixed flag of its own, which is why this reads its
// JSON rather than its exit code. Two details carry the whole result:
//
//   - the severity lives on the *group*, not the vulnerability, so it has to be mapped back
//     onto every id the group lists before a per-vulnerability decision can be made;
//   - "fixable" means some affected range carries a `fixed` event. An advisory with only
//     `introduced` events has no published fix, which is the OSV spelling of --ignore-unfixed.
func ReadOSV(r io.Reader) (Report, error) {
	var doc osvReport
	if err := json.NewDecoder(r).Decode(&doc); err != nil {
		return Report{}, fmt.Errorf("reading OSV-Scanner report: %w", err)
	}

	var report Report
	var blocking []Finding

	for _, result := range doc.Results {
		for _, pkg := range result.Packages {
			severityByID, err := severities(pkg.Groups)
			if err != nil {
				return Report{}, err
			}

			for _, vuln := range pkg.Vulnerabilities {
				report.Reported++
				if severityByID[vuln.ID] < Threshold || !hasFix(vuln.Affected) {
					continue
				}
				blocking = append(blocking, Finding{
					ID:       vuln.ID,
					Package:  pkg.Package.Name,
					Version:  pkg.Package.Version,
					Severity: severityByID[vuln.ID],
				})
			}
		}
	}

	report.Blocking = dedupe(blocking)
	return report, nil
}

// severities maps each group's max_severity onto every vulnerability id in that group. A group
// with no score contributes nothing, so its ids score 0 and never block - the same outcome the
// Python this replaced got by leaving the key out of its dict.
func severities(groups []osvGroup) (map[string]float64, error) {
	byID := make(map[string]float64)
	for _, group := range groups {
		if group.MaxSeverity == "" {
			continue
		}
		score, err := strconv.ParseFloat(group.MaxSeverity, 64)
		if err != nil {
			return nil, fmt.Errorf("max_severity %q is not a number: %w", group.MaxSeverity, err)
		}
		for _, id := range group.IDs {
			byID[id] = score
		}
	}
	return byID, nil
}

func hasFix(affected []osvAffected) bool {
	for _, a := range affected {
		for _, r := range a.Ranges {
			for _, event := range r.Events {
				if _, ok := event["fixed"]; ok {
					return true
				}
			}
		}
	}
	return false
}
