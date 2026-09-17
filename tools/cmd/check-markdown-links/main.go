// Command check-markdown-links checks the links in every Markdown file in the repo.
//
//	go run ./tools/cmd/check-markdown-links [config.json]
//
// It drives the markdown-link-check npm binary, which is still what resolves each link -
// reimplementing HTTP and filesystem link checking would be a second, differently-wrong
// checker. What lives here is the loop and the exit-code aggregation: markdown-link-check
// handles one file per invocation, and `find -exec` does not propagate a failing exit code back
// out, so it has to be explicit. Every file is checked even after one fails, so a run reports
// every broken link rather than the first.
//
// The config file decides WHICH links get checked, and the two are run at different times for a
// reason:
//
//	.markdown-link-check.json           relative links only (ignorePatterns drops http(s)).
//	                                    Filesystem-only, so it is instant, offline and
//	                                    deterministic - and it is the half a pull request can
//	                                    actually break, by moving a file something links to.
//	                                    Runs on every PR (ci.yml's `links` job).
//	.markdown-link-check.external.json  every link, including external URLs. Slow and network-
//	                                    dependent - ~40 URLs, most of them github.com, which
//	                                    rate-limits unauthenticated runners (hence retryOn429).
//	                                    It fails for reasons that have nothing to do with the
//	                                    commit, so it runs weekly instead (link-check.yml).
package main

import (
	"fmt"
	"os"
	"os/exec"

	"github.com/wdalmeida/yaml-config-generator-validator/tools/internal/mdlinks"
)

const defaultConfig = ".markdown-link-check.json"

func main() {
	config := defaultConfig
	if len(os.Args) > 1 {
		config = os.Args[1]
	}

	files, err := mdlinks.Find(".")
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}

	status := 0
	for _, file := range files {
		fmt.Println("Checking", file)
		cmd := exec.Command("npx", "markdown-link-check", "-q", "-c", config, file)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		if err := cmd.Run(); err != nil {
			status = 1
		}
	}
	os.Exit(status)
}
