package buckets

import (
	"os/exec"
	"strings"
)

// Git is the subset of git this package uses, so the fail-open paths can be tested without a
// repository.
type Git interface {
	// HasSecondParent reports whether HEAD^2 resolves.
	HasSecondParent() bool
	// ChangedFiles returns the paths HEAD^1..HEAD touched.
	ChangedFiles() ([]string, error)
}

// ExecGit runs the real git binary in the current working directory.
type ExecGit struct{}

func (ExecGit) HasSecondParent() bool {
	return exec.Command("git", "rev-parse", "--verify", "--quiet", "HEAD^2").Run() == nil
}

// ChangedFiles diffs the PR merge commit's two parents.
//
// --no-renames matters: with rename detection --name-only prints only the destination path, so
// a moved docs/img/*.svg would not show its old path - exactly the case lint:links must catch.
func (ExecGit) ChangedFiles() ([]string, error) {
	out, err := exec.Command("git", "diff", "--name-only", "--no-renames", "HEAD^1", "HEAD").Output()
	if err != nil {
		return nil, err
	}
	return splitLines(string(out)), nil
}

func splitLines(s string) []string {
	var paths []string
	for _, line := range strings.Split(s, "\n") {
		if line = strings.TrimRight(line, "\r"); line != "" {
			paths = append(paths, line)
		}
	}
	return paths
}

// For is the whole decision, fail-open at every step (rule 1 in the package comment).
//
// Only `pull_request` is ever gated (rule 3): every other event name - including an empty one -
// gets every bucket.
//
// actions/checkout leaves the job on refs/pull/N/merge, whose two parents are the base tip
// (HEAD^1) and the PR head (HEAD^2), so HEAD^1..HEAD is exactly the PR's delta with no
// dependence on the event payload's shas having been fetched. If HEAD^2 is missing we are not
// on a merge ref (a `ref:` input or pull_request_target would do that) and HEAD^1 would
// silently mean "the previous commit on this branch" instead, so that case bails out rather
// than gating on the wrong diff.
func For(eventName string, git Git) (Result, []string) {
	if eventName != "pull_request" {
		name := eventName
		if name == "" {
			name = "unknown"
		}
		return AllTrue("event is " + name + ", not pull_request"), nil
	}

	if !git.HasSecondParent() {
		return AllTrue("HEAD is not a PR merge commit"), nil
	}

	changed, err := git.ChangedFiles()
	if err != nil {
		return AllTrue("git diff failed: " + err.Error()), nil
	}
	if len(changed) == 0 {
		return AllTrue("empty diff"), nil
	}

	return Classify(changed), changed
}
