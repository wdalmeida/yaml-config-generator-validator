// Package ciok checks that ci.yml's `ci-ok` gate job lists every other job in its `needs:`.
//
// ci-ok is the only required status check for `main`, so a job missing from its `needs:` is
// enforced by nothing at all - which is exactly how the previous per-context ruleset silently
// stopped covering `helm` and `plumber`. Fail loudly instead.
package ciok

import (
	"fmt"
	"sort"

	"gopkg.in/yaml.v3"
)

// Gate is the job whose needs: list must name every other job.
const Gate = "ci-ok"

// workflow is the subset of a workflow file this check reads. yaml.Node keeps the jobs in file
// order, which is what makes the "missing" report read top-to-bottom like the file does.
type workflow struct {
	Jobs yaml.Node `yaml:"jobs"`
}

// Result is what one check produced.
type Result struct {
	// Jobs is every job id in the file, in declaration order, excluding the gate itself.
	Jobs []string
	// Missing lists jobs the gate does not need, in declaration order.
	Missing []string
	// Dangling lists ids the gate needs that are not jobs, sorted.
	Dangling []string
}

// OK reports whether the gate covers the file exactly.
func (r Result) OK() bool { return len(r.Missing) == 0 && len(r.Dangling) == 0 }

// Check parses a workflow file's bytes and compares its job list against the gate's needs:.
func Check(source []byte) (Result, error) {
	var doc workflow
	if err := yaml.Unmarshal(source, &doc); err != nil {
		return Result{}, fmt.Errorf("parsing workflow: %w", err)
	}
	if doc.Jobs.Kind != yaml.MappingNode {
		return Result{}, fmt.Errorf("workflow has no jobs: mapping")
	}

	var ids []string
	var gate *yaml.Node
	// A YAML mapping node stores keys and values as alternating children.
	for i := 0; i+1 < len(doc.Jobs.Content); i += 2 {
		id := doc.Jobs.Content[i].Value
		if id == Gate {
			gate = doc.Jobs.Content[i+1]
			continue
		}
		ids = append(ids, id)
	}
	if gate == nil {
		return Result{}, fmt.Errorf("workflow has no %q job", Gate)
	}

	needs, err := needsOf(gate)
	if err != nil {
		return Result{}, err
	}

	result := Result{Jobs: ids}
	for _, id := range ids {
		if _, ok := needs[id]; !ok {
			result.Missing = append(result.Missing, id)
		}
	}

	known := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		known[id] = struct{}{}
	}
	for need := range needs {
		if _, ok := known[need]; !ok {
			result.Dangling = append(result.Dangling, need)
		}
	}
	sort.Strings(result.Dangling)

	return result, nil
}

// needsOf reads a job's needs:, which GitHub Actions accepts as either a single string or a
// sequence of them.
func needsOf(job *yaml.Node) (map[string]struct{}, error) {
	needs := map[string]struct{}{}
	if job.Kind != yaml.MappingNode {
		return nil, fmt.Errorf("%q is not a mapping", Gate)
	}
	for i := 0; i+1 < len(job.Content); i += 2 {
		if job.Content[i].Value != "needs" {
			continue
		}
		value := job.Content[i+1]
		switch value.Kind {
		case yaml.ScalarNode:
			if value.Value != "" {
				needs[value.Value] = struct{}{}
			}
		case yaml.SequenceNode:
			for _, item := range value.Content {
				needs[item.Value] = struct{}{}
			}
		default:
			return nil, fmt.Errorf("%q has a needs: that is neither a string nor a list", Gate)
		}
	}
	return needs, nil
}
