// Package buckets works out which categories of file a pull request touched, so ci.yml can
// skip the jobs that cannot possibly be affected.
//
// Four rules govern everything here, and every one of them is load-bearing:
//
//  1. FAIL OPEN. Every unexpected condition - a non-PR event, a missing parent, an error
//     anywhere - reports every bucket as changed, so CI over-runs rather than under-runs. A
//     skipped job reports "skipped", which ci-ok accepts, so silently skipping a job that
//     should have run is the one failure mode that lets a broken PR through. Classify never
//     returns an error for that reason: it returns a Result whose Reason says why everything
//     is on.
//  2. ANY .github/** CHANGE RUNS EVERYTHING. renovate.json automerges the workflow
//     tool-version group precisely because ci.yml's own actionlint/gitleaks/zizmor/helm jobs
//     exercise a bump. A HELM_VERSION bump touches only ci.yml, so without this rule the helm
//     job would skip and the PR would automerge completely unexercised. The same applies to
//     the justfile and to the Go module that implements this classification.
//  3. ONLY `pull_request` IS EVER GATED. Pushes to main, the crons and manual runs always run
//     the full suite, so a mis-defined pattern below is caught after the merge rather than
//     never.
//  4. THE `links` BUCKET IS DELIBERATELY WIDER THAN `markdown`. lint:links resolves relative
//     links that point OUT of markdown, so moving any of the files those links name breaks
//     one.
package buckets

import "regexp"

// Names is the bucket list, in the order it is reported and written to $GITHUB_OUTPUT. It is
// also the list ci.yml's `changes` job declares as outputs.
var Names = []string{"app", "schemas", "markdown", "links", "deps", "charts", "workflows", "go", "renovate"}

// npmDeps is shared by every npm-driven job: oxlint, ajv, markdownlint-cli2 and vitest all
// come from here.
const npmDeps = `^package(-lock)?\.json$`

// everythingPattern matches the paths that force every bucket on (rule 2). `.github/**` is the
// reason it exists; the justfile and this Go module are here because they decide what the jobs
// below actually run, exactly as scripts/changed-buckets.sh was before it became Go.
var everythingPattern = regexp.MustCompile(`^(\.github/|justfile$|tools/|go\.mod$|go\.sum$)`)

// patterns maps each bucket to the paths that make it true. Keep the comments: each one
// records why the pattern is as wide as it is.
var patterns = map[string]*regexp.Regexp{
	"app":     regexp.MustCompile(`^(src/|public/|index\.html$|vite\.config\.ts$|tsconfig.*\.json$|\.oxlintrc\.json$|\.size-limit\.json$)|` + npmDeps),
	"schemas": regexp.MustCompile(`^src/|` + npmDeps),
	// markdownlint reads the .md files and its own config, nothing else.
	"markdown": regexp.MustCompile(`\.md$|^\.markdownlint-cli2\.jsonc$|` + npmDeps),
	// Wider than "markdown" on purpose (rule 4): lint:links resolves relative links that point
	// OUT of markdown - ../charts/.../ci/both-limits-values.yaml, LICENSE,
	// docs/capacity-report.html, docs/img/*.svg - so moving any of those breaks a link. The
	// docs also link into tools/ (the load-test commands), which everythingPattern above
	// already covers, so it is not repeated here.
	"links":  regexp.MustCompile(`\.md$|^(\.markdown-link-check.*\.json$|docs/|charts/|LICENSE$)|` + npmDeps),
	"deps":   regexp.MustCompile(npmDeps),
	"charts": regexp.MustCompile(`^(charts/|\.kube-linter\.yaml$)`),
	// Unreachable in practice - a .github/** change already forced everything on above - but
	// kept so the mapping is complete and each job's `if:` reads honestly.
	"workflows": regexp.MustCompile(`^\.github/`),
	// Same: everythingPattern already covers tools/ and the module files, so this is only ever
	// read on an all-true run. It exists so the `go` job's `if:` names its own inputs rather
	// than borrowing an unrelated bucket - if tools/ is ever dropped from everythingPattern,
	// this keeps the job correct instead of silently never running.
	"go": regexp.MustCompile(`^(tools/|go\.mod$|go\.sum$)`),
	// renovate.json is in no other bucket - nothing else in CI reads it - so without this the
	// only feedback on a typo there is Renovate opening a Config Warning issue after the merge.
	"renovate": regexp.MustCompile(`^renovate\.json$`),
}

// Result is what a classification run produced: one value per bucket in Names, plus the reason
// every bucket was forced on when that is what happened.
type Result struct {
	Values map[string]bool
	// Reason is empty for an ordinary per-file classification, and otherwise says why every
	// bucket is true. It is printed so a CI log always explains an all-true run.
	Reason string
}

// AllTrue reports every bucket as changed, with the reason why. This is the fail-open path
// (rule 1) and the .github/** path (rule 2).
func AllTrue(reason string) Result {
	values := make(map[string]bool, len(Names))
	for _, name := range Names {
		values[name] = true
	}
	return Result{Values: values, Reason: reason}
}

// Classify maps a list of changed paths onto the buckets. A path under .github/, the justfile
// or the Go module that implements this turns everything on.
//
// It deliberately has no error return: there is no input it can refuse. An empty list is
// handled by the caller, which treats it as "something is wrong with the diff" and fails open.
func Classify(changed []string) Result {
	for _, path := range changed {
		if everythingPattern.MatchString(path) {
			return AllTrue("a workflow, the justfile or the tools/ Go module changed")
		}
	}

	values := make(map[string]bool, len(Names))
	for _, name := range Names {
		values[name] = matchesAny(patterns[name], changed)
	}
	return Result{Values: values}
}

func matchesAny(pattern *regexp.Regexp, changed []string) bool {
	for _, path := range changed {
		if pattern.MatchString(path) {
			return true
		}
	}
	return false
}
