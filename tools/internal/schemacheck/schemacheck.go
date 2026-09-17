// Package schemacheck holds the two passes over the JSON files this app loads at build time.
//
//  1. src/configs/schemas/*.schema.json are validated against the real JSON Schema draft
//     2020-12 meta-schema - a check our own converter (src/configs/json-schema.ts) can't give
//     us, since it only cares whether a file satisfies the narrow subset it understands, not
//     whether the file is actually valid JSON Schema in general (e.g. `required` as a string
//     instead of an array would likely be silently ignored by our converter, but is
//     spec-invalid).
//
//  2. src/onboarding/*.onboarding.json are *data*, not schema documents, so the meta-schema has
//     nothing to say about them. They're validated against our own checked-in meta-schema (the
//     same one their $schema key points at, so an editor and CI agree), plus the referential
//     and semantic checks that meta-schema cannot express. Zod re-checks the same shape at
//     runtime; this pass is what turns a malformed file into a CI failure rather than a white
//     screen.
//
// Unknown keywords are ignored rather than rejected: our x-* vendor extensions are unrecognized
// keywords by design (that is the whole point of the x- prefix convention), and a compliant
// JSON Schema validator ignores them.
package schemacheck

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

// KubernetesPillID is the one pill a step's `config` action may name that is not discovered
// from a schema file: the Kubernetes pill isn't schema-driven (it renders manifests from two
// inputs rather than validating a file). Mirrors KUBERNETES_ID in src/kubernetes/index.ts.
const KubernetesPillID = "kubernetes"

// Result is one run of Check.
type Result struct {
	// Lines are the per-file OK/FAIL lines, in the order they were produced.
	Lines []string
	// Failed is true when any file failed, which is the command's exit code.
	Failed bool
}

func (r *Result) ok(file string) { r.Lines = append(r.Lines, "OK    "+file) }
func (r *Result) fail(file, message string) {
	r.Lines = append(r.Lines, "FAIL  "+file+": "+message)
	r.Failed = true
}
func (r *Result) fatal(message string) error { return fmt.Errorf("%s", message) }

// Check runs both passes against a repository root. It returns an error only for a condition
// that makes the check itself meaningless (a directory with no files in it); an invalid file is
// a Result failure, so every remaining file still gets reported.
func Check(root string) (Result, error) {
	var result Result

	schemasDir := filepath.Join(root, "src/configs/schemas")
	onboardingDir := filepath.Join(root, "src/onboarding")

	// Pills a step's `config` action may point at. The config types are discovered below.
	pillIDs := map[string]struct{}{KubernetesPillID: {}}

	schemaFiles, err := filesWithSuffix(schemasDir, ".schema.json")
	if err != nil {
		return result, err
	}
	if len(schemaFiles) == 0 {
		return result, result.fatal("No *.schema.json files found in " + schemasDir)
	}

	// --- Pass 1: config schemas are themselves JSON Schema documents ---------------------
	for _, file := range schemaFiles {
		path := filepath.Join(schemasDir, file)
		doc, err := loadJSON(path)
		if err != nil {
			result.fail(file, err.Error())
			continue
		}
		if err := compilable(path, doc); err != nil {
			result.fail(file, err.Error())
			continue
		}
		if object, ok := doc.(map[string]any); ok {
			if id, ok := object["x-config-id"].(string); ok && id != "" {
				pillIDs[id] = struct{}{}
			}
		}
		result.ok(file)
	}

	// --- Pass 2: onboarding checklists are data, checked against our own meta-schema ------
	onboardingFiles, err := filesWithSuffix(onboardingDir, ".onboarding.json")
	if err != nil {
		return result, err
	}
	if len(onboardingFiles) == 0 {
		return result, result.fatal("No *.onboarding.json files found in " + onboardingDir)
	}

	metaPath := filepath.Join(onboardingDir, "onboarding.meta.schema.json")
	meta, err := compile(metaPath)
	if err != nil {
		result.fail("onboarding.meta.schema.json", err.Error())
		return result, nil
	}

	for _, file := range onboardingFiles {
		path := filepath.Join(onboardingDir, file)
		doc, err := loadJSON(path)
		if err != nil {
			result.fail(file, err.Error())
			continue
		}
		if err := meta.Validate(doc); err != nil {
			result.fail(file, errorsText(err))
			continue
		}
		if messages := semanticIssues(doc, pillIDs); len(messages) > 0 {
			for _, message := range messages {
				result.fail(file, message)
			}
			continue
		}
		result.ok(file)
	}

	return result, nil
}

// semanticIssues carries the checks the meta-schema cannot express, because they are semantic
// rather than structural. Both are enforced again at runtime in src/onboarding/types.ts.
func semanticIssues(doc any, pillIDs map[string]struct{}) []string {
	object, _ := doc.(map[string]any)
	steps, _ := object["steps"].([]any)

	var messages []string
	var missing []string
	seen := map[string]struct{}{}

	for _, raw := range steps {
		step, _ := raw.(map[string]any)
		id, _ := step["id"].(string)
		if _, duplicate := seen[id]; duplicate {
			messages = append(messages, "duplicate step id: "+id)
		}
		seen[id] = struct{}{}

		// A command is by definition the CLI route, and one in the path-independent list would
		// be shown to a reader who explicitly selected the UI route - the one thing that switch
		// exists to prevent.
		for _, action := range actionList(step, "actions") {
			if action["type"] == "command" {
				messages = append(messages, fmt.Sprintf(
					"step %q: a command action belongs in `cli.actions`, not in the step's own `actions`", id))
				break
			}
		}

		// A `config` action must name a pill that exists, or the step renders a button that
		// goes nowhere - checked wherever it appears, including inside cli.actions/ui.actions.
		all := actionList(step, "actions")
		all = append(all, nestedActions(step, "cli")...)
		all = append(all, nestedActions(step, "ui")...)
		for _, action := range all {
			if action["type"] != "config" {
				continue
			}
			configID, _ := action["configId"].(string)
			if _, ok := pillIDs[configID]; !ok {
				missing = append(missing, id+" -> "+configID)
			}
		}
	}

	if len(missing) > 0 {
		messages = append(messages, "config action names an unknown pill: "+strings.Join(missing, ", "))
	}
	return messages
}

func actionList(holder map[string]any, key string) []map[string]any {
	raw, _ := holder[key].([]any)
	actions := make([]map[string]any, 0, len(raw))
	for _, item := range raw {
		if action, ok := item.(map[string]any); ok {
			actions = append(actions, action)
		}
	}
	return actions
}

func nestedActions(step map[string]any, route string) []map[string]any {
	block, _ := step[route].(map[string]any)
	if block == nil {
		return nil
	}
	return actionList(block, "actions")
}

func filesWithSuffix(dir, suffix string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var files []string
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), suffix) {
			files = append(files, entry.Name())
		}
	}
	sort.Strings(files)
	return files, nil
}

func loadJSON(path string) (any, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	return jsonschema.UnmarshalJSON(file)
}

// compile builds a validator from a schema file, which also validates the schema document
// itself against the draft 2020-12 meta-schema.
func compile(path string) (*jsonschema.Schema, error) {
	doc, err := loadJSON(path)
	if err != nil {
		return nil, err
	}
	compiler := jsonschema.NewCompiler()
	if err := compiler.AddResource(path, doc); err != nil {
		return nil, err
	}
	return compiler.Compile(path)
}

// compilable is pass 1's assertion: the document is a usable JSON Schema. It takes the already
// parsed document so a syntax error is reported once, by the caller.
func compilable(path string, doc any) error {
	// Compiling is the meta-schema check: the library validates every resource against the
	// draft its $schema names before it will build a validator out of it.
	compiler := jsonschema.NewCompiler()
	if err := compiler.AddResource(path, doc); err != nil {
		return err
	}
	_, err := compiler.Compile(path)
	return err
}

// errorsText flattens a validation failure into one line, the way ajv's errorsText did. The
// library's own Error() is an indented tree, which is unreadable in a one-line FAIL report.
func errorsText(err error) string {
	fields := strings.Split(err.Error(), "\n")
	for i, field := range fields {
		fields[i] = strings.TrimSpace(field)
	}
	return strings.Join(fields, "; ")
}
