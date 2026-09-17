package buckets

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// on is a readable spelling of "exactly these buckets are true, and no others".
func on(t *testing.T, got Result, want ...string) {
	t.Helper()
	for _, name := range Names {
		expected := slices.Contains(want, name)
		if got.Values[name] != expected {
			t.Errorf("bucket %q = %t, want %t (all: %v)", name, got.Values[name], expected, got.Values)
		}
	}
}

// TestGoldenParity is the load-bearing test of this package: every row was produced by running
// the real scripts/changed-buckets.sh, so this asserts the Go port classifies exactly as the
// bash did rather than as someone remembers it doing. See testdata/bucket-golden.tsv for how it
// was captured and why it could only be captured once.
func TestGoldenParity(t *testing.T) {
	source, err := os.ReadFile(filepath.Join("testdata", "bucket-golden.tsv"))
	if err != nil {
		t.Fatal(err)
	}

	rows := 0
	for _, line := range strings.Split(string(source), "\n") {
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		paths, want, found := strings.Cut(line, "\t")
		if !found {
			t.Fatalf("malformed golden row: %q", line)
		}
		rows++

		t.Run(paths, func(t *testing.T) {
			got := Classify(strings.Split(paths, "|"))
			if formatted := format(got); formatted != want {
				t.Errorf("\n got %s\nwant %s", formatted, want)
			}
		})
	}

	if rows < 30 {
		t.Fatalf("only %d golden rows loaded - the corpus did not parse", rows)
	}
}

// parityNames is the bucket set scripts/changed-buckets.sh had when bucket-golden.tsv was
// captured. Parity is asserted against exactly these: a bucket added later (like "go") is new
// behaviour with its own tests, not a regression against the bash, and folding it in here would
// invalidate every golden row for no reason.
var parityNames = []string{"app", "schemas", "markdown", "links", "deps", "charts", "workflows"}

func format(result Result) string {
	parts := make([]string, 0, len(parityNames))
	for _, name := range parityNames {
		value := "false"
		if result.Values[name] {
			value = "true"
		}
		parts = append(parts, name+"="+value)
	}
	return strings.Join(parts, ",")
}

// TestMovedScriptsOnlyEverRunMore covers the one place this port deliberately diverges from the
// bash: three patterns named files under scripts/, and those files are now Go under tools/,
// which the force-everything rule already covers. Every divergence must therefore be in the
// "runs more" direction. Running fewer jobs than the bash did would be a silent skip, which is
// the one failure mode rule 1 exists to prevent.
func TestMovedScriptsOnlyEverRunMore(t *testing.T) {
	moved := []struct {
		was string
		// wasBuckets is what the bash reported for `was`, captured in the same parity run that
		// produced testdata/bucket-golden.tsv.
		wasBuckets []string
		now        string
	}{
		{"scripts/changed-buckets.sh", Names, "tools/internal/buckets/buckets.go"},
		{"scripts/validate-json-schemas.mjs", []string{"schemas", "links"}, "tools/cmd/validate-schemas/main.go"},
		{"scripts/helm-loadtest.sh", []string{"links"}, "tools/cmd/helm-loadtest/main.go"},
		{"scripts/check-markdown-links.sh", []string{"links"}, "tools/cmd/check-markdown-links/main.go"},
	}

	for _, test := range moved {
		t.Run(test.now, func(t *testing.T) {
			got := Classify([]string{test.now})
			for _, name := range test.wasBuckets {
				if !got.Values[name] {
					t.Errorf("%s no longer runs the %q job, which %s did", test.now, name, test.was)
				}
			}
		})
	}
}

// npm deps reach every npm-driven job: oxlint, ajv, markdownlint-cli2 and vitest all come from
// the lockfile, so a bump has to run all of them.
func TestNpmDepsReachEveryNpmJob(t *testing.T) {
	for _, file := range []string{"package.json", "package-lock.json"} {
		on(t, Classify([]string{file}), "app", "schemas", "markdown", "links", "deps")
	}
}

// RULE 2. A .github/** change runs everything. renovate.json automerges the workflow
// tool-version group *on the grounds that* ci.yml's own actionlint/gitleaks/zizmor/helm jobs
// exercise a bump - and a HELM_VERSION bump touches only ci.yml. Without this rule that PR
// would automerge completely unexercised, so deleting it is a supply-chain regression, not a
// tidy-up. The justfile and the Go module that implements this are here for the same reason.
func TestAnyBuildInfrastructureChangeRunsEverything(t *testing.T) {
	for _, file := range []string{
		".github/workflows/ci.yml",
		".github/workflows/container.yml",
		".github/dependabot.yml",
		"justfile",
		"tools/internal/buckets/buckets.go",
		"tools/cmd/scan-gate/main.go",
		"go.mod",
		"go.sum",
	} {
		t.Run(file, func(t *testing.T) {
			got := Classify([]string{file})
			if got.Reason == "" {
				t.Fatalf("%s did not force every bucket on", file)
			}
			on(t, got, Names...)
		})
	}
}

// The rule is "any", not "only": a workflow change arriving alongside files that would classify
// narrowly still wins.
func TestWorkflowChangeWinsOverOtherFiles(t *testing.T) {
	on(t, Classify([]string{"README.md", ".github/workflows/ci.yml"}), Names...)
}

// RULE 4. The links bucket is deliberately wider than markdown, because lint:links resolves
// relative links that point OUT of markdown. A charts/ or docs/ file that is not itself
// markdown must still run the link check - otherwise moving docs/img/capacity-latency.svg
// passes CI and breaks the rendered docs.
func TestLinksBucketIsWiderThanMarkdown(t *testing.T) {
	for _, file := range []string{
		"docs/img/capacity-latency.svg",
		"docs/capacity-report.html",
		"charts/yaml-config-generator-validator/ci/both-limits-values.yaml",
		"LICENSE",
	} {
		t.Run(file, func(t *testing.T) {
			got := Classify([]string{file})
			if !got.Values["links"] {
				t.Errorf("%s must set the links bucket", file)
			}
			if got.Values["markdown"] {
				t.Errorf("%s must NOT set the markdown bucket - that asymmetry is the point", file)
			}
		})
	}
}

type fakeGit struct {
	secondParent bool
	changed      []string
	err          error
}

func (g fakeGit) HasSecondParent() bool           { return g.secondParent }
func (g fakeGit) ChangedFiles() ([]string, error) { return g.changed, g.err }

// RULE 1. Fail open. Every unexpected condition reports every bucket as changed: over-running
// is cheap, silently skipping a job that should have run is the failure that lets a broken PR
// through (a skipped job reports "skipped", which ci-ok accepts).
//
// RULE 3. Only pull_request is ever gated, so a mis-defined pattern is still caught by the full
// suite on the main push rather than never.
func TestFailsOpen(t *testing.T) {
	tests := []struct {
		name       string
		event      string
		git        fakeGit
		wantReason string
	}{
		{"a push to main", "push", fakeGit{secondParent: true, changed: []string{"README.md"}}, "not pull_request"},
		{"a scheduled run", "schedule", fakeGit{}, "not pull_request"},
		{"a manual run", "workflow_dispatch", fakeGit{}, "not pull_request"},
		{"pull_request_target", "pull_request_target", fakeGit{secondParent: true}, "not pull_request"},
		{"no event at all", "", fakeGit{}, "event is unknown"},
		{"not on a merge ref", "pull_request", fakeGit{secondParent: false}, "not a PR merge commit"},
		{"git failed", "pull_request", fakeGit{secondParent: true, err: errors.New("boom")}, "git diff failed"},
		{"an empty diff", "pull_request", fakeGit{secondParent: true}, "empty diff"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, _ := For(test.event, test.git)
			if !strings.Contains(got.Reason, test.wantReason) {
				t.Fatalf("reason = %q, want it to mention %q", got.Reason, test.wantReason)
			}
			on(t, got, Names...)
		})
	}
}

// A real pull_request with a real diff is the only case that gates anything at all.
func TestPullRequestGates(t *testing.T) {
	got, changed := For("pull_request", fakeGit{secondParent: true, changed: []string{"README.md"}})
	if got.Reason != "" {
		t.Fatalf("unexpected all-true: %s", got.Reason)
	}
	if !slices.Equal(changed, []string{"README.md"}) {
		t.Fatalf("changed = %v", changed)
	}
	on(t, got, "markdown", "links")
}

func TestSplitLinesIgnoresBlankAndCarriageReturns(t *testing.T) {
	got := splitLines("a.md\r\n\nb.md\n")
	if want := []string{"a.md", "b.md"}; !slices.Equal(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestAllTrueCoversEveryDeclaredBucket(t *testing.T) {
	got := AllTrue("because")
	if len(got.Values) != len(Names) {
		t.Fatalf("AllTrue produced %d values for %d buckets", len(got.Values), len(Names))
	}
	on(t, got, Names...)
}

// Every bucket in Names must have a pattern, or Classify silently reports it false forever.
func TestEveryBucketHasAPattern(t *testing.T) {
	for _, name := range Names {
		if patterns[name] == nil {
			t.Errorf("bucket %q has no pattern", name)
		}
	}
	if len(patterns) != len(Names) {
		t.Errorf("%d patterns for %d buckets - one of them is unreachable", len(patterns), len(Names))
	}
}

// --- integration: the real git plumbing, against a real merge ref -------------------------

// TestExecGitOnARealMergeRef builds the repository shape actions/checkout produces for a pull
// request - a merge commit whose first parent is the base tip and whose second is the PR head -
// and drives the real git binary over it.
//
// It covers the two decisions the bash comment called out and that no unit test can reach:
// diffing HEAD^1..HEAD rather than trusting the event payload's shas, and --no-renames, without
// which `--name-only` prints only a moved file's destination path and the link checker never
// learns the old one is gone.
func TestExecGitOnARealMergeRef(t *testing.T) {
	if testing.Short() {
		t.Skip("needs the git binary")
	}
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}

	repo := t.TempDir()
	git := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = repo
		// core.hooksPath is neutralised so a globally configured pre-commit hook (this repo
		// installs a gitleaks one) cannot run inside the fixture.
		cmd.Env = append(os.Environ(), "GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_SYSTEM=/dev/null")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	write := func(name, content string) {
		t.Helper()
		path := filepath.Join(repo, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	git("init", "-q", "-b", "main", ".")
	git("config", "user.email", "t@example.com")
	git("config", "user.name", "t")
	git("config", "core.hooksPath", "/dev/null")
	git("config", "commit.gpgsign", "false")

	// The base tip carries a file the PR will move, so rename detection has something to find.
	write("docs/img/before.svg", "<svg/>\n")
	write("seed.txt", "seed\n")
	git("add", "-A")
	git("commit", "-q", "-m", "base")

	git("checkout", "-q", "-b", "pr")
	git("mv", "docs/img/before.svg", "docs/img/after.svg")
	git("commit", "-q", "-m", "move the diagram")

	git("checkout", "-q", "main")
	// A commit on the base branch after the PR branched: HEAD^1 must be *this*, so a naive
	// HEAD~1 diff would report it as part of the PR.
	write("unrelated.txt", "moved on\n")
	git("add", "-A")
	git("commit", "-q", "-m", "base moves on")
	git("merge", "-q", "--no-ff", "--no-edit", "pr")

	t.Chdir(repo)

	execGit := ExecGit{}
	if !execGit.HasSecondParent() {
		t.Fatal("the fixture is not a merge commit - the rest of this test is meaningless")
	}

	changed, err := execGit.ChangedFiles()
	if err != nil {
		t.Fatal(err)
	}
	slices.Sort(changed)

	want := []string{"docs/img/after.svg", "docs/img/before.svg"}
	if !slices.Equal(changed, want) {
		t.Fatalf("changed = %v, want %v\n"+
			"both sides of the move must appear: with rename detection --name-only prints only "+
			"the destination, and lint:links would never learn the old path is gone. "+
			"unrelated.txt must NOT appear: it is on the base branch, not in the PR.", changed, want)
	}

	result, _ := For("pull_request", execGit)
	on(t, result, "links")
}

// TestGoBucketNamesItsOwnInputs guards the "go" bucket added alongside the tools/ module. It is
// currently unreachable on its own - everythingPattern matches tools/, go.mod and go.sum, so any
// change to them forces every bucket true before the per-bucket patterns are consulted. That is
// exactly why it is worth pinning: if tools/ is ever narrowed out of everythingPattern, the go
// job must still run for a change to the module, and this test fails if the pattern stops
// matching rather than letting the job quietly never run again.
func TestGoBucketNamesItsOwnInputs(t *testing.T) {
	for _, path := range []string{
		"tools/cmd/scan-gate/main.go",
		"tools/internal/buckets/buckets.go",
		"go.mod",
		"go.sum",
	} {
		t.Run(path, func(t *testing.T) {
			if !patterns["go"].MatchString(path) {
				t.Errorf("the go bucket pattern does not match %q", path)
			}
			// It must also still force everything on, which is the behaviour in force today.
			if got := Classify([]string{path}); got.Reason == "" {
				t.Errorf("%q no longer forces every bucket on (reason empty)", path)
			}
		})
	}

	for _, path := range []string{"src/App.tsx", "README.md", "charts/x/values.yaml"} {
		t.Run("not "+path, func(t *testing.T) {
			if patterns["go"].MatchString(path) {
				t.Errorf("the go bucket pattern should not match %q", path)
			}
		})
	}
}
