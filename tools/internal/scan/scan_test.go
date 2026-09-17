package scan

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func read(t *testing.T, name string) *os.File {
	t.Helper()
	file, err := os.Open(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { file.Close() })
	return file
}

func readTrivy(t *testing.T, name string) Report {
	t.Helper()
	report, err := ReadTrivy(read(t, name))
	if err != nil {
		t.Fatal(err)
	}
	return report
}

func readOSV(t *testing.T, name string) Report {
	t.Helper()
	report, err := ReadOSV(read(t, name))
	if err != nil {
		t.Fatal(err)
	}
	return report
}

// The bar both engines are held to. Everything below is one of the four cases that bar has:
// blocking, below threshold, unfixable, and accepted.
func TestThresholdIsTheNumericSpellingOfHighCritical(t *testing.T) {
	if Threshold != 7.0 {
		t.Fatalf("Threshold = %v; HIGH starts at 7.0, and the two engines are only comparable "+
			"because OSV's CVSS gate uses the same number Trivy's HIGH band does", Threshold)
	}
}

// --- Trivy --------------------------------------------------------------------------------

func TestTrivyBlocksFixableHighAndCritical(t *testing.T) {
	report := readTrivy(t, "trivy-alpine.json")

	if report.Reported != 10 {
		t.Errorf("Reported = %d, want the 10 findings in the real report", report.Reported)
	}
	// CVE-2026-40200 is HIGH and fixed in 1.2.4_git20230717-r6; it hits two packages (musl and
	// musl-utils), which is two distinct blocking lines, not one deduplicated to death.
	if len(report.Blocking) != 2 {
		t.Fatalf("Blocking = %v, want the two fixable HIGH findings", report.Blocking)
	}
	for _, finding := range report.Blocking {
		if !strings.Contains(finding, "CVE-2026-40200") || !strings.Contains(finding, "HIGH") {
			t.Errorf("unexpected blocking finding %q", finding)
		}
	}
}

// The below-threshold case: MEDIUM and LOW findings are reported but never block, however many
// of them there are. An unfixed advisory staying visible without reddening the build is the
// whole reason the gate is not simply "any finding".
func TestTrivyIgnoresBelowThreshold(t *testing.T) {
	report := readTrivy(t, "trivy-alpine.json")
	for _, finding := range report.Blocking {
		for _, below := range []string{"CVE-2024-58251", "CVE-2025-46394", "CVE-2026-6042"} {
			if strings.Contains(finding, below) {
				t.Errorf("%s is MEDIUM or LOW and must not block", below)
			}
		}
	}
	if report.Reported <= len(report.Blocking) {
		t.Error("the below-threshold findings should still be counted as reported")
	}
}

// The unfixable case: same HIGH finding, same CVSS, no fixed version. Trivy's own
// --ignore-unfixed drops it, so the gate must too - otherwise every image with an unpatched
// upstream advisory is permanently red and the gate stops meaning anything.
func TestTrivyIgnoresUnfixable(t *testing.T) {
	report := readTrivy(t, "trivy-alpine-unfixed.json")
	if len(report.Blocking) != 0 {
		t.Fatalf("Blocking = %v, want nothing: the HIGH finding has no fix", report.Blocking)
	}
	if report.Reported != 10 {
		t.Errorf("Reported = %d, want it still counted as reported", report.Reported)
	}
}

// The ignore-file interaction. Trivy applies --ignorefile while producing the report, so an
// accepted finding never reaches this package - which is exactly why the dated acceptance keeps
// working with no code here to know about dates.
func TestTrivyRespectsADatedAcceptance(t *testing.T) {
	before := readTrivy(t, "trivy-alpine.json")
	after := readTrivy(t, "trivy-alpine-accepted.json")

	if len(before.Blocking) == 0 {
		t.Fatal("the un-accepted report must block, or this test proves nothing")
	}
	if len(after.Blocking) != 0 {
		t.Fatalf("Blocking = %v, want nothing once .trivyignore.yaml accepts it", after.Blocking)
	}
	if after.Reported >= before.Reported {
		t.Error("an accepted finding should be gone from the report, not merely non-blocking")
	}
}

// A HIGH/CRITICAL secret has no fixed version to have. --ignore-unfixed applies to
// vulnerabilities only, so a credential baked into the image must still fail the build.
func TestTrivyBlocksHighSecretsDespiteHavingNoFix(t *testing.T) {
	report := readTrivy(t, "trivy-secret.json")
	if len(report.Blocking) != 1 {
		t.Fatalf("Blocking = %v, want the one CRITICAL secret", report.Blocking)
	}
	if !strings.Contains(report.Blocking[0], "aws-access-key-id") {
		t.Errorf("blocking finding = %q, want the CRITICAL secret rule", report.Blocking[0])
	}
	if report.Reported != 2 {
		t.Errorf("Reported = %d, want both secrets counted", report.Reported)
	}
}

// Coverage reporting. A scanner that cannot identify the image reports nothing and exits 0,
// which is indistinguishable in a check list from a clean image - so the gate has to be able to
// say which of the two it is looking at.
func TestTrivyReportsWhatItCouldSee(t *testing.T) {
	real := readTrivy(t, "trivy-alpine.json")
	if real.OSFamily != "alpine" {
		t.Errorf("OSFamily = %q, want alpine", real.OSFamily)
	}
	if real.Packages != 15 {
		t.Errorf("Packages = %d, want the 15 the real scan enumerated", real.Packages)
	}

	blind := readTrivy(t, "trivy-no-packages.json")
	if blind.OSFamily != "none" || blind.Packages != 0 {
		t.Fatalf("OSFamily = %q, Packages = %d; a report with no OS must be reported as "+
			"\"none\"/0 so the warning can fire", blind.OSFamily, blind.Packages)
	}
	if len(blind.Blocking) != 0 {
		t.Error("a scan that enumerated nothing cannot have blocking findings")
	}
}

// --- OSV-Scanner --------------------------------------------------------------------------

func TestOSVBlocksFixableHighAndCritical(t *testing.T) {
	report := readOSV(t, "osv-alpine.json")

	if len(report.Blocking) != 1 {
		t.Fatalf("Blocking = %v, want the single fixable CVSS>=7.0 finding", report.Blocking)
	}
	want := "ALPINE-CVE-2026-40200 musl 1.2.4_git20230717-r5 (CVSS 8.1)"
	if report.Blocking[0] != want {
		t.Errorf("Blocking[0] = %q, want %q", report.Blocking[0], want)
	}
}

// OSV-Scanner repeats the same finding across several results and packages. Reporting it once
// per occurrence would turn one base-image advisory into a wall of identical lines, so the
// blocking list is deduplicated while the reported count is not.
func TestOSVDeduplicatesBlockingFindings(t *testing.T) {
	report := readOSV(t, "osv-alpine.json")
	if report.Reported <= len(report.Blocking) {
		t.Fatalf("Reported = %d with %d blocking: the fixture repeats findings, so the raw "+
			"count must exceed the deduplicated one", report.Reported, len(report.Blocking))
	}
	if len(slices.Compact(slices.Clone(report.Blocking))) != len(report.Blocking) {
		t.Errorf("Blocking has duplicates: %v", report.Blocking)
	}
	if !slices.IsSorted(report.Blocking) {
		t.Errorf("Blocking is not sorted, so the log order depends on scan order: %v", report.Blocking)
	}
}

// The below-threshold case. max_severity lives on the group, not the vulnerability, so this is
// also what proves the group -> id mapping works: get it wrong and every id scores 0 and this
// test passes for the wrong reason - which is why TestOSVBlocksFixableHighAndCritical above
// asserts the 8.1 finding does block.
func TestOSVIgnoresBelowThreshold(t *testing.T) {
	report := readOSV(t, "osv-alpine.json")
	for _, finding := range report.Blocking {
		for _, below := range []string{"ALPINE-CVE-2024-58251", "ALPINE-CVE-2025-46394", "ALPINE-CVE-2026-6042"} {
			if strings.Contains(finding, below) {
				t.Errorf("%s scores below 7.0 and must not block", below)
			}
		}
	}
}

// The unfixable case: OSV's spelling of --ignore-unfixed is "no affected range carries a fixed
// event".
func TestOSVIgnoresUnfixable(t *testing.T) {
	report := readOSV(t, "osv-alpine-unfixed.json")
	if len(report.Blocking) != 0 {
		t.Fatalf("Blocking = %v, want nothing: the CVSS 8.1 finding has no published fix", report.Blocking)
	}
}

// The ignore-file interaction, and the property docs/container.md leans on: ignoreUntil removes
// the finding from the JSON entirely, which is what lets this gate stay date-unaware.
func TestOSVRespectsADatedAcceptance(t *testing.T) {
	before := readOSV(t, "osv-alpine.json")
	after := readOSV(t, "osv-alpine-accepted.json")

	if len(before.Blocking) == 0 {
		t.Fatal("the un-accepted report must block, or this test proves nothing")
	}
	if len(after.Blocking) != 0 {
		t.Fatalf("Blocking = %v, want nothing once osv-scanner.toml accepts it", after.Blocking)
	}
	if after.Reported >= before.Reported {
		t.Error("an accepted finding should be gone from the report, not merely non-blocking")
	}
}

// --- both engines -------------------------------------------------------------------------

// The point of the shared package: the same image, scanned by two engines with different
// databases and different ids, must fail the build for the same finding. If these ever diverge,
// one of the two gates has silently stopped agreeing with the other.
func TestBothEnginesAgreeOnTheSameImage(t *testing.T) {
	trivy := readTrivy(t, "trivy-alpine.json")
	osv := readOSV(t, "osv-alpine.json")

	if (len(trivy.Blocking) > 0) != (len(osv.Blocking) > 0) {
		t.Fatalf("engines disagree on the same image: trivy %v, osv %v", trivy.Blocking, osv.Blocking)
	}
	// Trivy says CVE-2026-40200, OSV says ALPINE-CVE-2026-40200 - the Alpine advisory for the
	// same CVE. Same package, same version.
	if !strings.Contains(trivy.Blocking[0], "musl") || !strings.Contains(osv.Blocking[0], "musl") {
		t.Errorf("expected both to name musl: trivy %q, osv %q", trivy.Blocking[0], osv.Blocking[0])
	}
}

func TestMalformedReportsAreAnError(t *testing.T) {
	if _, err := ReadTrivy(strings.NewReader("not json")); err == nil {
		t.Error("ReadTrivy accepted non-JSON")
	}
	if _, err := ReadOSV(strings.NewReader("not json")); err == nil {
		t.Error("ReadOSV accepted non-JSON")
	}
	// An unparseable max_severity is reported rather than silently scored 0, which would let a
	// blocking finding through.
	bad := `{"results":[{"packages":[{"package":{"name":"p","version":"1"},
	         "groups":[{"ids":["X"],"max_severity":"high"}],"vulnerabilities":[{"id":"X"}]}]}]}`
	if _, err := ReadOSV(strings.NewReader(bad)); err == nil {
		t.Error("ReadOSV accepted a non-numeric max_severity")
	}
}

// An empty report is a pass, not a crash: both scanners produce one for an image with nothing
// in it.
func TestEmptyReports(t *testing.T) {
	trivy, err := ReadTrivy(strings.NewReader(`{}`))
	if err != nil || len(trivy.Blocking) != 0 || trivy.OSFamily != "none" {
		t.Errorf("empty Trivy report: %+v, %v", trivy, err)
	}
	osv, err := ReadOSV(strings.NewReader(`{}`))
	if err != nil || len(osv.Blocking) != 0 || osv.Reported != 0 {
		t.Errorf("empty OSV report: %+v, %v", osv, err)
	}
}
