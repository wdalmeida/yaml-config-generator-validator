// Command helm-capacity measures the capacity of one replica with BOTH limits set - for
// platforms that mandate a CPU limit as well as a memory one, where helm-loadtest's "no CPU
// limit" default isn't an option. It reports saturation throughput and latency percentiles for
// one (cpu, memory, concurrency) point; docs/helm-chart.md has the matrix these produced.
//
//	go run ./tools/cmd/helm-capacity <cpu-limit> <mem-limit> <connections> <path> [fixed-qps]
//	go run ./tools/cmd/helm-capacity 500m 256Mi 1000 /assets/index-abc123.js
//
// Manual, like helm-loadtest: it needs a cluster, an image the cluster can pull, and a few
// minutes per point. Connections are not requests - one keepalive connection carries many
// sequential requests, so <connections> is how many sockets are held open, not a rate.
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/wdalmeida/yaml-config-generator-validator/tools/internal/loadtest"
)

const usage = `usage: helm-capacity <cpu-limit> <mem-limit> <connections> <path> [fixed-qps]`

func main() {
	args := os.Args[1:]
	if len(args) < 4 || len(args) > 5 {
		fmt.Fprintln(os.Stderr, usage)
		os.Exit(2)
	}
	cpuLimit, memLimit, path := args[0], args[1], args[3]
	connections, err := strconv.Atoi(args[2])
	if err != nil {
		fmt.Fprintln(os.Stderr, "connections must be a number:", err)
		os.Exit(2)
	}
	fixed := ""
	if len(args) == 5 {
		fixed = args[4]
	}
	qps := loadtest.Or(fixed, "0")

	if !loadtest.ClusterReachable() {
		fmt.Fprintln(os.Stderr, "no reachable cluster - kubectl cluster-info fails")
		os.Exit(1)
	}

	install := []string{
		"--set", "resources.requests.cpu=10m",
		"--set", "resources.requests.memory=32Mi",
	}
	install = append(install, loadtest.LimitsArg(cpuLimit, memLimit)...)

	if err := loadtest.Install(install); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	url := loadtest.ServiceURL(path)
	out := loadtest.Fortio(connections, 20, qps, url)
	report := loadtest.ParseFortio(out)

	// A run that produced no throughput line is a harness/scheduling hiccup, not a result -
	// retry once and keep the raw output either way, rather than reporting a silent ERR.
	if report.QPS == "" {
		time.Sleep(5 * time.Second)
		out = loadtest.Fortio(connections, 20, qps, url)
		report = loadtest.ParseFortio(out)
	}
	if report.QPS == "" {
		log := filepath.Join(os.TempDir(), fmt.Sprintf("capacity-fail-%s-%d.log", cpuLimit, connections))
		if err := os.WriteFile(log, []byte(out), 0o600); err == nil {
			fmt.Fprintf(os.Stderr, "  (raw output kept at %s)\n", log)
		}
	}

	restarts, terminated := loadtest.PodStatus()

	line := fmt.Sprintf("cpu=%-6s mem=%-6s c=%-4d rate=%-6s | %9s req/s | p50 %7sms p90 %7sms p99 %8sms | 200=%-8s restarts=%s",
		cpuLimit, memLimit, connections, loadtest.Or(fixed, "max"),
		loadtest.Or(report.QPS, "ERR"),
		loadtest.Or(report.Percentiles[50], "?"),
		loadtest.Or(report.Percentiles[90], "?"),
		loadtest.Or(report.Percentiles[99], "?"),
		loadtest.Or(report.OK, "0"),
		loadtest.Or(restarts, "?"))

	if len(report.Bad) > 0 {
		line += fmt.Sprintf(" ERRORS: %v", report.Bad)
	}
	if terminated != "" {
		line += " OOM/TERM: " + terminated
	}
	fmt.Println(line)
}
