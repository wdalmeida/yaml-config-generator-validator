package schemacheck

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// repoRoot is the checkout this package lives in. Several tests below run against the real
// src/ tree, which is the strongest available fixture: it is the thing CI actually validates.
func repoRoot() string { return filepath.Join("..", "..", "..") }

// fakeRoot builds a throwaway repository layout. The onboarding meta-schema is COPIED from the
// real one rather than reproduced here: a frozen copy would drift the moment someone adds a
// field, and these tests would then be validating a shape the app no longer uses.
func fakeRoot(t *testing.T, schemas, onboarding map[string]string) string {
	t.Helper()
	root := t.TempDir()

	schemaDir := filepath.Join(root, "src", "configs", "schemas")
	onboardingDir := filepath.Join(root, "src", "onboarding")
	for _, dir := range []string{schemaDir, onboardingDir} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}

	meta, err := os.ReadFile(filepath.Join(repoRoot(), "src", "onboarding", "onboarding.meta.schema.json"))
	if err != nil {
		t.Fatal(err)
	}
	write(t, filepath.Join(onboardingDir, "onboarding.meta.schema.json"), string(meta))

	for name, body := range schemas {
		write(t, filepath.Join(schemaDir, name), body)
	}
	for name, body := range onboarding {
		write(t, filepath.Join(onboardingDir, name), body)
	}
	return root
}

func write(t *testing.T, path, body string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

const validSchema = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Example",
  "x-config-id": "example",
  "x-default-filename": "example.yml",
  "type": "object",
  "required": ["tenant"],
  "properties": { "tenant": { "type": "string", "maxLength": 12 } }
}`

// step builds a one-step onboarding file around whatever step body is given.
func step(body string) string {
	return `{
  "title": "Example",
  "x-onboarding-id": "example",
  "steps": [` + body + `]
}`
}

func run(t *testing.T, root string) Result {
	t.Helper()
	result, err := Check(root)
	if err != nil {
		t.Fatalf("Check: %v", err)
	}
	return result
}

func failures(result Result) []string {
	var out []string
	for _, line := range result.Lines {
		if strings.HasPrefix(line, "FAIL") {
			out = append(out, line)
		}
	}
	return out
}

// The repository's own files are the golden case: whatever else changes, `npm run lint:schemas`
// has to keep passing on the tree it ships.
func TestTheRealRepositoryPasses(t *testing.T) {
	result, err := Check(repoRoot())
	if err != nil {
		t.Fatal(err)
	}
	if result.Failed {
		t.Fatalf("the checked-in files do not validate:\n%s", strings.Join(failures(result), "\n"))
	}
	if len(result.Lines) < 6 {
		t.Fatalf("only %d files checked; the repo has five config schemas and an onboarding file",
			len(result.Lines))
	}
}

func TestAValidTreePasses(t *testing.T) {
	root := fakeRoot(t,
		map[string]string{"example.schema.json": validSchema},
		map[string]string{"example.onboarding.json": step(`{"id": "one", "title": "Do the thing"}`)})

	if result := run(t, root); result.Failed {
		t.Fatalf("%v", failures(result))
	}
}

// Pass 1's whole point: our own converter only cares about the subset it understands, so a file
// that is not valid JSON Schema at all would otherwise reach the browser. `required` as a string
// is the example the old script's comment named.
func TestRequiredAsAStringIsSpecInvalid(t *testing.T) {
	broken := strings.Replace(validSchema, `"required": ["tenant"]`, `"required": "tenant"`, 1)
	root := fakeRoot(t,
		map[string]string{"broken.schema.json": broken},
		map[string]string{"example.onboarding.json": step(`{"id": "one", "title": "Do the thing"}`)})

	result := run(t, root)
	if !result.Failed {
		t.Fatal("a schema with a string `required` was accepted")
	}
	if got := failures(result); len(got) != 1 || !strings.Contains(got[0], "broken.schema.json") {
		t.Errorf("failures = %v, want one naming broken.schema.json", got)
	}
}

// x-* vendor extensions are unrecognised keywords by design - that is the entire point of the
// x- prefix - and a conforming validator ignores them. If this ever starts failing, every
// config type in the repo fails with it.
func TestVendorExtensionsAreNotErrors(t *testing.T) {
	root := fakeRoot(t,
		map[string]string{"example.schema.json": validSchema},
		map[string]string{"example.onboarding.json": step(`{"id": "one", "title": "Do the thing"}`)})
	if result := run(t, root); result.Failed {
		t.Fatalf("x-config-id / x-default-filename rejected: %v", failures(result))
	}
}

func TestMalformedJSONIsReported(t *testing.T) {
	root := fakeRoot(t,
		map[string]string{"example.schema.json": validSchema, "truncated.schema.json": `{"type":`},
		map[string]string{"example.onboarding.json": step(`{"id": "one", "title": "Do the thing"}`)})

	result := run(t, root)
	if got := failures(result); len(got) != 1 || !strings.Contains(got[0], "truncated.schema.json") {
		t.Errorf("failures = %v, want one naming truncated.schema.json", got)
	}
}

// Pass 2, structural: the meta-schema is `additionalProperties: false` on purpose. These are
// hand-authored files, where a typo'd key is a mistake to report rather than an extra to
// quietly drop.
func TestOnboardingTypoIsReported(t *testing.T) {
	root := fakeRoot(t,
		map[string]string{"example.schema.json": validSchema},
		map[string]string{"example.onboarding.json": step(`{"id": "one", "title": "Do it", "detials": "typo"}`)})

	result := run(t, root)
	if !result.Failed {
		t.Fatal("a typo'd key was accepted")
	}
}

// Pass 2, semantic. A `config` action must name a pill that exists, or the step renders a button
// that goes nowhere. The meta-schema cannot express it: the set of valid ids is discovered from
// the schema files in pass 1.
func TestConfigActionMustNameAKnownPill(t *testing.T) {
	root := fakeRoot(t,
		map[string]string{"example.schema.json": validSchema},
		map[string]string{"example.onboarding.json": step(
			`{"id": "one", "title": "Do it", "actions": [{"type": "config", "configId": "nope", "label": "Go"}]}`)})

	result := run(t, root)
	if !result.Failed {
		t.Fatal("a config action naming a nonexistent pill was accepted")
	}
	if got := failures(result); !strings.Contains(strings.Join(got, "\n"), "one -> nope") {
		t.Errorf("failures = %v, want the offending step -> id pair", got)
	}
}

// ...including the id discovered from a schema file's x-config-id, and the Kubernetes pill,
// which is not schema-driven and so is named in code.
func TestKnownPillsComeFromSchemasAndKubernetes(t *testing.T) {
	root := fakeRoot(t,
		map[string]string{"example.schema.json": validSchema},
		map[string]string{"example.onboarding.json": step(
			`{"id": "one", "title": "Do it", "actions": [
				{"type": "config", "configId": "example", "label": "Go"},
				{"type": "config", "configId": "kubernetes", "label": "Also go"}]}`)})

	if result := run(t, root); result.Failed {
		t.Fatalf("%v", failures(result))
	}
}

// A configId is checked wherever it appears, including inside the cli/ui route blocks - those
// are the ones a reader on that route actually sees.
func TestConfigActionIsCheckedInsideRouteBlocks(t *testing.T) {
	for _, route := range []string{"cli", "ui"} {
		t.Run(route, func(t *testing.T) {
			body := `{"id": "one", "title": "Do it", "` + route + `": {` +
				`"instructions": ["something"], ` +
				`"actions": [{"type": "config", "configId": "nope", "label": "Go"}]}}`
			root := fakeRoot(t,
				map[string]string{"example.schema.json": validSchema},
				map[string]string{"example.onboarding.json": step(body)})

			if result := run(t, root); !result.Failed {
				t.Fatalf("a bad configId inside %s.actions was accepted", route)
			}
		})
	}
}

// The other semantic rule, and the one that protects the CLI/UI switch: a command is by
// definition the CLI route, so one in the path-independent `actions` list would be shown to a
// reader who explicitly asked for clicks - the single thing that switch exists to prevent.
func TestCommandActionMayNotSitInThePathIndependentList(t *testing.T) {
	root := fakeRoot(t,
		map[string]string{"example.schema.json": validSchema},
		map[string]string{"example.onboarding.json": step(
			`{"id": "one", "title": "Do it", "actions": [{"type": "command", "command": "ls"}]}`)})

	result := run(t, root)
	if !result.Failed {
		t.Fatal("a command action in the step's own actions was accepted")
	}
	if got := strings.Join(failures(result), "\n"); !strings.Contains(got, "cli.actions") {
		t.Errorf("failures = %v, want the message to say where it belongs", failures(result))
	}
}

// ...and the same action inside cli.actions is correct, not merely tolerated.
func TestCommandActionIsFineInsideTheCliRoute(t *testing.T) {
	root := fakeRoot(t,
		map[string]string{"example.schema.json": validSchema},
		map[string]string{"example.onboarding.json": step(
			`{"id": "one", "title": "Do it", "cli": {"instructions": ["run it"], ` +
				`"actions": [{"type": "command", "command": "ls"}]}}`)})

	if result := run(t, root); result.Failed {
		t.Fatalf("%v", failures(result))
	}
}

func TestDuplicateStepIdsAreReported(t *testing.T) {
	root := fakeRoot(t,
		map[string]string{"example.schema.json": validSchema},
		map[string]string{"example.onboarding.json": `{
			"title": "Example", "x-onboarding-id": "example",
			"steps": [{"id": "one", "title": "First"}, {"id": "one", "title": "Second"}]}`})

	result := run(t, root)
	if got := strings.Join(failures(result), "\n"); !strings.Contains(got, "duplicate step id: one") {
		t.Errorf("failures = %v, want a duplicate-id report", failures(result))
	}
}

// An empty directory is a fatal error rather than a pass. "No schemas found" reported as
// success is how a broken glob turns into a green check that validates nothing.
func TestAnEmptyTreeIsFatal(t *testing.T) {
	root := fakeRoot(t, nil, nil)
	if _, err := Check(root); err == nil {
		t.Fatal("a tree with no schema files was accepted")
	}

	root = fakeRoot(t, map[string]string{"example.schema.json": validSchema}, nil)
	if _, err := Check(root); err == nil {
		t.Fatal("a tree with no onboarding files was accepted")
	}
}

// One bad file must not hide the rest: every remaining file is still reported, so a run fixes
// everything in one pass.
func TestEveryFileIsReported(t *testing.T) {
	root := fakeRoot(t,
		map[string]string{
			"example.schema.json": validSchema,
			"broken.schema.json":  strings.Replace(validSchema, `"required": ["tenant"]`, `"required": "tenant"`, 1),
		},
		map[string]string{"example.onboarding.json": step(`{"id": "one", "title": "Do it"}`)})

	result := run(t, root)
	if len(result.Lines) != 3 {
		t.Fatalf("lines = %v, want one per file", result.Lines)
	}
}
