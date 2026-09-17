// Command helm-loadtest runs one load test against the Helm chart, inside whatever cluster
// kubectl currently points at.
//
// This is a manual tool - nothing in CI runs it, because it needs a cluster and several
// minutes - but every resource number in docs/helm-chart.md and charts/*/values.yaml came out
// of it, and those numbers are only worth trusting if you can reproduce them.
//
//	just loadtest                                   # the default sweep
//	go run ./tools/cmd/helm-loadtest <label> <cpu-request> <cpu-limit|none> <mem-limit> \
//	                                 <connections> <seconds> [path]
//
// It deploys into the "load" namespace and leaves the release behind for inspection;
// `helm uninstall load -n load` when done.
package main

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/wdalmeida/yaml-config-generator-validator/tools/internal/loadtest"
)

const usage = `usage: helm-loadtest <label> <cpu-request> <cpu-limit|none> <mem-limit> <connections> <seconds> [path]`

func main() {
	args := os.Args[1:]
	if len(args) < 6 || len(args) > 7 {
		fmt.Fprintln(os.Stderr, usage)
		os.Exit(2)
	}
	label, cpuRequest, cpuLimit, memLimit := args[0], args[1], args[2], args[3]
	connections, err := strconv.Atoi(args[4])
	if err != nil {
		fmt.Fprintln(os.Stderr, "connections must be a number:", err)
		os.Exit(2)
	}
	seconds, err := strconv.Atoi(args[5])
	if err != nil {
		fmt.Fprintln(os.Stderr, "seconds must be a number:", err)
		os.Exit(2)
	}
	path := "/"
	if len(args) == 7 {
		path = args[6]
	}

	if !loadtest.ClusterReachable() {
		fmt.Fprintln(os.Stderr, "no reachable cluster - kubectl cluster-info fails")
		os.Exit(1)
	}

	install := []string{
		"--set", "resources.requests.cpu=" + cpuRequest,
		"--set", "resources.requests.memory=16Mi",
	}
	install = append(install, loadtest.LimitsArg(cpuLimit, memLimit)...)

	if err := loadtest.Install(install); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	pod := loadtest.PodName()

	// Sampling runs alongside the load rather than after it: `kubectl top` reports current
	// working set, so a reading taken once the load stopped measures an idle pod. The peak is
	// the number the memory limit has to survive.
	ctx, stop := context.WithCancel(context.Background())
	samples := make(chan string, 1)
	go func() { samples <- loadtest.Sample(ctx, pod, 2*time.Second) }()

	report := loadtest.ParseFortio(loadtest.Fortio(connections, seconds, "0", loadtest.ServiceURL(path)))

	stop()
	peakCPU, peakMemory := loadtest.Peaks(<-samples)

	restarts, terminated := loadtest.PodStatus()

	line := fmt.Sprintf("%-14s req=%-5s lim=%-5s mem=%-6s c=%-3d | %9s req/s | p50 %6sms p99 %6sms | peak %5s %6s | 200s=%-8s restarts=%s",
		label, cpuRequest, cpuLimit, memLimit, connections,
		loadtest.Or(report.QPS, "ERR"),
		loadtest.Or(report.Percentiles[50], "?"),
		loadtest.Or(report.Percentiles[99], "?"),
		fmt.Sprintf("%dm", peakCPU), fmt.Sprintf("%dMi", peakMemory),
		loadtest.Or(report.OK, "0"),
		loadtest.Or(restarts, "?"))

	if len(report.Bad) > 0 {
		line += fmt.Sprintf(" ERRORS: %v", report.Bad)
	}
	if terminated != "" {
		line += " LAST_TERM=" + terminated
	}
	fmt.Println(line)
}
