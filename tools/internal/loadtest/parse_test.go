package loadtest

import (
	"slices"
	"strings"
	"testing"
)

// A trimmed but verbatim-shaped fortio 1.75.3 report: the lines the parser reads, in the order
// and spacing fortio prints them. The "Code  -1" row is two spaces and a minus sign, which is
// the detail the shell version got wrong.
const fortioReport = `Fortio 1.75.3 running at 0 queries per second, 10->10 procs, for 15s
Starting at max qps with 100 thread(s) [gomax 10] for 15s
Ended after 15.002s : 42315 calls. qps=2820.6
Aggregated Function Time : count 42315 avg 0.035 +/- 0.02 min 0.002 max 0.31 sum 1481.02
# range, mid point, percentile, count
>= 0.002 <= 0.31 , 0.156 , 100.00, 42315
# target 50% 0.0331084
# target 75% 0.0412
# target 90% 0.0533333
# target 99% 0.118571
# target 99.9% 0.29
Error cases : no data
Sockets used: 100 (for perfect keepalive, would be 100)
Uniform: false, Jitter: false
Code 200 : 42315 (100.0 %)
Response Header Sizes : count 42315 avg 245
All done 42315 calls (plus 0 warmup) 35.001 ms avg, 2820.6 qps
`

func TestParseFortio(t *testing.T) {
	report := ParseFortio(fortioReport)

	if report.QPS != "2820.6" {
		t.Errorf("QPS = %q, want 2820.6", report.QPS)
	}
	if report.OK != "42315" {
		t.Errorf("OK = %q, want 42315", report.OK)
	}
	if len(report.Bad) != 0 {
		t.Errorf("Bad = %v, want none", report.Bad)
	}

	// Seconds in, milliseconds out.
	want := map[int]string{50: "33.11", 90: "53.33", 99: "118.57"}
	for percentile, wantValue := range want {
		if got := report.Percentiles[percentile]; got != wantValue {
			t.Errorf("p%d = %q, want %q", percentile, got, wantValue)
		}
	}
	// 75% and 99.9% are printed by fortio and deliberately not collected.
	if _, ok := report.Percentiles[75]; ok {
		t.Error("p75 was collected; only 50/90/99 are reported")
	}
}

// This is the bug the shell comment warns about, and it is worth a test of its own: fortio
// reports a response it could not read as "Code  -1" - two spaces, a minus sign. A pattern of
// `^Code [0-9]+` matches neither the spacing nor the sign, so every failed run reports as clean
// and the measurement looks like a server-side result.
func TestParseFortioCatchesCodeMinusOne(t *testing.T) {
	out := strings.Replace(fortioReport,
		"Code 200 : 42315 (100.0 %)",
		"Code  -1 : 21000 (49.6 %)\nCode 200 : 21315 (50.4 %)", 1)

	report := ParseFortio(out)
	if len(report.Bad) != 1 {
		t.Fatalf("Bad = %v, want the Code -1 row", report.Bad)
	}
	if !strings.Contains(report.Bad[0], "-1") {
		t.Errorf("Bad[0] = %q, want it to name the -1 code", report.Bad[0])
	}
	if report.OK != "21315" {
		t.Errorf("OK = %q, want the 200 count only", report.OK)
	}
}

func TestParseFortioCatchesServerErrors(t *testing.T) {
	out := strings.Replace(fortioReport,
		"Code 200 : 42315 (100.0 %)",
		"Code 200 : 40000 (94.5 %)\nCode 503 : 2315 (5.5 %)", 1)

	report := ParseFortio(out)
	if len(report.Bad) != 1 || !strings.Contains(report.Bad[0], "503") {
		t.Fatalf("Bad = %v, want the 503 row", report.Bad)
	}
}

// A run that produced no throughput line is a harness or scheduling hiccup, not a result. It
// has to come back empty so the caller can retry rather than print a number it did not measure.
func TestParseFortioOnAFailedRun(t *testing.T) {
	report := ParseFortio("Error: connection refused\n")
	if report.QPS != "" {
		t.Errorf("QPS = %q, want empty", report.QPS)
	}
	if Or(report.QPS, "ERR") != "ERR" {
		t.Error("a missing measurement must report ERR rather than a blank column")
	}
}

func TestPeaksTakesTheHighestSample(t *testing.T) {
	samples := `load-yaml-config-generator-validator-abc   12m   5Mi
load-yaml-config-generator-validator-abc   480m   36Mi
load-yaml-config-generator-validator-abc   310m   28Mi
`
	cpu, memory := Peaks(samples)
	if cpu != 480 {
		t.Errorf("cpu = %d, want the 480m peak", cpu)
	}
	// 36Mi is the number docs/helm-chart.md's "don't drop limits.memory below 64Mi" rests on:
	// an idle reading of 5Mi is the trap.
	if memory != 36 {
		t.Errorf("memory = %d, want the 36Mi peak", memory)
	}
}

// The sampler runs while the pod may be starting, restarting or gone, and kubectl prints an
// error line rather than a sample then. Those must be skipped, not parsed as a zero that drags
// nothing down or a garbage value that becomes the peak.
func TestPeaksSkipsNonSamples(t *testing.T) {
	samples := `error: Metrics not available for pod load/abc, age: 1.5s
load-yaml-config-generator-validator-abc   12m   5Mi
Error from server (NotFound): podmetrics.metrics.k8s.io "load/abc" not found
`
	cpu, memory := Peaks(samples)
	if cpu != 12 || memory != 5 {
		t.Errorf("cpu = %d, memory = %d, want 12/5 from the single real sample", cpu, memory)
	}
}

func TestPeaksOnNoSamples(t *testing.T) {
	if cpu, memory := Peaks(""); cpu != 0 || memory != 0 {
		t.Errorf("cpu = %d, memory = %d, want zeroes", cpu, memory)
	}
}

// `--set resources.limits.cpu=null` writes a literal 0 in Helm 4, which the API server rejects
// as "requests must be <= limit of 0". "No CPU limit" therefore has to be expressed by leaving
// the key out of a replaced limits map, not by nulling it.
func TestLimitsArgOmitsTheCpuKeyRatherThanNullingIt(t *testing.T) {
	got := LimitsArg("none", "128Mi")
	if !slices.Equal(got, []string{"--set-json", `resources.limits={"memory":"128Mi"}`}) {
		t.Fatalf("LimitsArg(none) = %v", got)
	}
	for _, arg := range got {
		if strings.Contains(arg, "cpu") {
			t.Errorf("the no-limit form must not mention cpu at all: %q", arg)
		}
	}

	got = LimitsArg("500m", "256Mi")
	if !slices.Equal(got, []string{"--set-json", `resources.limits={"cpu":"500m","memory":"256Mi"}`}) {
		t.Fatalf("LimitsArg(500m) = %v", got)
	}

	// An empty string is the same request as "none" - both mean "the caller did not set one".
	if !slices.Equal(LimitsArg("", "64Mi"), LimitsArg("none", "64Mi")) {
		t.Error(`"" and "none" must mean the same thing`)
	}
}

func TestOr(t *testing.T) {
	if Or("", "fallback") != "fallback" {
		t.Error("empty should fall back")
	}
	if Or("value", "fallback") != "value" {
		t.Error("non-empty should win")
	}
}

func TestServiceURL(t *testing.T) {
	if got := ServiceURL("/assets/index-abc.js"); got != "http://load-yaml-config-generator-validator/assets/index-abc.js" {
		t.Errorf("ServiceURL = %q", got)
	}
}
