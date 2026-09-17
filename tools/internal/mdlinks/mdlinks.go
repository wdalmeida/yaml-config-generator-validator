// Package mdlinks walks the repository's Markdown files and runs the markdown-link-check npm
// binary over each one, aggregating the exit codes.
//
// The HTTP/filesystem checking itself stays in markdown-link-check: reimplementing it would be
// a second, differently-wrong link checker. What this package owns is the part that was a shell
// loop - markdown-link-check handles one file per invocation, and `find -exec` does not
// propagate a failing exit code back out, so the aggregation has to be explicit.
package mdlinks

import (
	"io/fs"
	"path/filepath"
	"sort"
	"strings"
)

// SkipDirs are the directories that never hold repository Markdown: installed dependencies and
// the pinned-tool cache, both of which carry thousands of vendored .md files.
var SkipDirs = map[string]bool{
	"node_modules": true,
	".ci-tools":    true,
	".git":         true,
}

// Find returns every *.md file under root, in a stable order so a failing run is reproducible
// and a log diff is readable.
func Find(root string) ([]string, error) {
	var files []string
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			if SkipDirs[entry.Name()] {
				return fs.SkipDir
			}
			return nil
		}
		if strings.HasSuffix(entry.Name(), ".md") {
			files = append(files, path)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Strings(files)
	return files, nil
}
