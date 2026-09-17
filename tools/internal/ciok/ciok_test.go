package ciok

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func check(t *testing.T, source string) Result {
	t.Helper()
	result, err := Check([]byte(source))
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func TestCoversEveryJob(t *testing.T) {
	result := check(t, `
jobs:
  test:
    runs-on: ubuntu-latest
  helm:
    runs-on: ubuntu-latest
  ci-ok:
    needs: [test, helm]
    runs-on: ubuntu-latest
`)
	if !result.OK() {
		t.Fatalf("missing %v, dangling %v", result.Missing, result.Dangling)
	}
	if want := []string{"test", "helm"}; !slices.Equal(result.Jobs, want) {
		t.Errorf("Jobs = %v, want %v in declaration order", result.Jobs, want)
	}
}

// This is the whole reason the check exists. The repository ruleset used to name each job as a
// required context, and that list silently stopped covering `helm` and `plumber` when they were
// added - enforced by nothing, while docs/releasing.md claimed every job was required.
func TestReportsAJobMissingFromTheGate(t *testing.T) {
	result := check(t, `
jobs:
  test:
    runs-on: ubuntu-latest
  helm:
    runs-on: ubuntu-latest
  plumber:
    runs-on: ubuntu-latest
  ci-ok:
    needs: [test]
    runs-on: ubuntu-latest
`)
	if result.OK() {
		t.Fatal("a job missing from the gate was accepted")
	}
	if want := []string{"helm", "plumber"}; !slices.Equal(result.Missing, want) {
		t.Errorf("Missing = %v, want %v", result.Missing, want)
	}
}

// The other direction: a `needs:` entry naming a job that no longer exists. GitHub Actions
// itself errors on this, but it errors at run time, on the workflow that was supposed to be
// the safety net.
func TestReportsADanglingNeed(t *testing.T) {
	result := check(t, `
jobs:
  test:
    runs-on: ubuntu-latest
  ci-ok:
    needs: [test, deleted-job]
    runs-on: ubuntu-latest
`)
	if result.OK() {
		t.Fatal("a dangling need was accepted")
	}
	if want := []string{"deleted-job"}; !slices.Equal(result.Dangling, want) {
		t.Errorf("Dangling = %v, want %v", result.Dangling, want)
	}
}

// GitHub Actions accepts `needs:` as a bare string as well as a list.
func TestNeedsMayBeAScalar(t *testing.T) {
	result := check(t, `
jobs:
  test:
    runs-on: ubuntu-latest
  ci-ok:
    needs: test
    runs-on: ubuntu-latest
`)
	if !result.OK() {
		t.Fatalf("missing %v, dangling %v", result.Missing, result.Dangling)
	}
}

// A gate with no needs: at all is the worst case - every check passes vacuously - so it must
// report every job, not zero.
func TestAGateWithNoNeedsReportsEveryJob(t *testing.T) {
	result := check(t, `
jobs:
  test:
    runs-on: ubuntu-latest
  helm:
    runs-on: ubuntu-latest
  ci-ok:
    runs-on: ubuntu-latest
`)
	if want := []string{"test", "helm"}; !slices.Equal(result.Missing, want) {
		t.Errorf("Missing = %v, want %v", result.Missing, want)
	}
}

func TestErrors(t *testing.T) {
	for _, source := range []string{
		"jobs:\n  test:\n    runs-on: ubuntu-latest\n", // no gate job at all
		"name: CI\n",      // no jobs: mapping
		"\t- not: yaml\n", // not parseable
	} {
		if _, err := Check([]byte(source)); err == nil {
			t.Errorf("accepted %q", source)
		}
	}
}

// The real file, which is what CI runs this against. It is also how a `go` job added to ci.yml
// without being added to ci-ok's needs: gets caught before it is pushed.
func TestTheRealWorkflow(t *testing.T) {
	path := filepath.Join("..", "..", "..", ".github", "workflows", "ci.yml")
	source, err := os.ReadFile(path)
	if err != nil {
		t.Skipf("no %s to check: %v", path, err)
	}

	result, err := Check(source)
	if err != nil {
		t.Fatal(err)
	}
	if !result.OK() {
		t.Fatalf("%s: missing from %s's needs: %v; dangling: %v", path, Gate, result.Missing, result.Dangling)
	}
	if len(result.Jobs) < 5 {
		t.Fatalf("only %d jobs parsed out of the real workflow - the parse is wrong", len(result.Jobs))
	}
	if !slices.Contains(result.Jobs, "go") {
		t.Error("ci.yml has no `go` job, so nothing builds, vets or tests tools/")
	}
}
