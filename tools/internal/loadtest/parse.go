// Package loadtest parses what a load-test run produced: fortio's report and `kubectl top pod`
// samples.
//
// The parsing is the part that was getting wrong answers before, which is why it is here and
// tested rather than left as a chain of grep/awk:
//
//   - the non-200 match has to accept "Code  -1" (two spaces, a minus sign) as well as
//     "Code 503". A pattern of `^Code [0-9]+` silently reports every run as clean, and "Code -1"
//     is precisely the failure mode that matters: fortio reports an aborted read that way.
//   - the latency percentiles are reported in seconds and wanted in milliseconds.
package loadtest

import (
	"regexp"
	"strconv"
	"strings"
)

// Report is everything read out of one fortio run.
type Report struct {
	// QPS is the throughput fortio reported, or "" when the run produced no throughput line at
	// all - a harness or scheduling hiccup rather than a result.
	QPS string
	// Percentiles maps a percentile (50, 90, 99) to its latency in milliseconds, formatted.
	Percentiles map[int]string
	// OK is the count of 200 responses, "" when none were reported.
	OK string
	// Bad lists every non-200 "Code N : count" line, in report order.
	Bad []string
}

var (
	qpsLine        = regexp.MustCompile(`^Ended after .*\bqps=([0-9.]+)`)
	targetLine     = regexp.MustCompile(`^# target (\d+)% ([0-9.eE+-]+)`)
	codeLine       = regexp.MustCompile(`^Code\s+(-?\d+) : (\d+)`)
	topPodLine     = regexp.MustCompile(`^\S+\s+(\d+)m\s+(\d+)Mi`)
	wantPercentile = map[int]bool{50: true, 90: true, 99: true}
)

// ParseFortio reads a fortio `load` run's combined output.
func ParseFortio(out string) Report {
	report := Report{Percentiles: map[int]string{}}

	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimRight(line, "\r")

		if match := qpsLine.FindStringSubmatch(line); match != nil && report.QPS == "" {
			report.QPS = match[1]
			continue
		}

		if match := targetLine.FindStringSubmatch(line); match != nil {
			percentile, err := strconv.Atoi(match[1])
			if err != nil || !wantPercentile[percentile] {
				continue
			}
			// fortio prints the first occurrence of each target; later ones are a second
			// histogram in the same output, so the first wins.
			if _, seen := report.Percentiles[percentile]; seen {
				continue
			}
			seconds, err := strconv.ParseFloat(match[2], 64)
			if err != nil {
				continue
			}
			report.Percentiles[percentile] = strconv.FormatFloat(seconds*1000, 'f', 2, 64)
			continue
		}

		if match := codeLine.FindStringSubmatch(line); match != nil {
			if match[1] == "200" {
				report.OK = match[2]
			} else {
				report.Bad = append(report.Bad, strings.TrimSpace(line))
			}
		}
	}

	return report
}

// Peaks reads `kubectl top pod --no-headers` samples and returns the highest CPU (millicores)
// and memory (MiB) seen. Unparseable lines are skipped: the sampler runs while the pod may be
// starting or gone, and kubectl prints an error line there rather than a sample.
func Peaks(samples string) (cpu int, memory int) {
	for _, line := range strings.Split(samples, "\n") {
		match := topPodLine.FindStringSubmatch(strings.TrimSpace(line))
		if match == nil {
			continue
		}
		if value, err := strconv.Atoi(match[1]); err == nil && value > cpu {
			cpu = value
		}
		if value, err := strconv.Atoi(match[2]); err == nil && value > memory {
			memory = value
		}
	}
	return cpu, memory
}

// Or returns value, or fallback when value is empty - the "${qps:-ERR}" idiom the shell
// versions used to report a missing measurement honestly rather than printing a blank column.
func Or(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
