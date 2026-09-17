package mdlinks

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestFindWalksTheTreeAndSkipsVendoredMarkdown(t *testing.T) {
	root := t.TempDir()
	for _, path := range []string{
		"README.md",
		"docs/container.md",
		"docs/img/note.md",
		"node_modules/some-package/README.md",
		".ci-tools/darwin-arm64/bin/NOTES.md",
		".git/HEAD.md",
		"src/App.tsx",
		"docs/capacity-report.html",
	} {
		full := filepath.Join(root, filepath.FromSlash(path))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	found, err := Find(root)
	if err != nil {
		t.Fatal(err)
	}

	var relative []string
	for _, path := range found {
		rel, err := filepath.Rel(root, path)
		if err != nil {
			t.Fatal(err)
		}
		relative = append(relative, filepath.ToSlash(rel))
	}

	want := []string{"README.md", "docs/container.md", "docs/img/note.md"}
	if !slices.Equal(relative, want) {
		t.Errorf("found %v, want %v", relative, want)
	}
}

// node_modules alone holds thousands of vendored .md files; checking them would take minutes
// and report links this repo cannot fix.
func TestSkipDirsCoversTheVendoredTrees(t *testing.T) {
	for _, dir := range []string{"node_modules", ".ci-tools", ".git"} {
		if !SkipDirs[dir] {
			t.Errorf("%s is not skipped", dir)
		}
	}
}

// A stable order makes a failing run reproducible and its log diffable against the last one.
func TestFindIsSorted(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"z.md", "a.md", "m.md"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	found, err := Find(root)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.IsSorted(found) {
		t.Errorf("Find returned %v, which is not sorted", found)
	}
}

// The repository's own tree, which is what `npm run lint:links` walks. Catches a skip rule wide
// enough to swallow real documentation.
func TestFindsTheRepositoryDocs(t *testing.T) {
	found, err := Find(filepath.Join("..", "..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	if len(found) < 10 {
		t.Fatalf("found only %d markdown files in the repo: %v", len(found), found)
	}

	var names []string
	for _, path := range found {
		names = append(names, filepath.ToSlash(path))
	}
	for _, want := range []string{"CLAUDE.md", "README.md", "docs/container.md"} {
		if !slices.ContainsFunc(names, func(p string) bool {
			return p == filepath.ToSlash(filepath.Join("..", "..", "..", want))
		}) {
			t.Errorf("%s was not found", want)
		}
	}
}
