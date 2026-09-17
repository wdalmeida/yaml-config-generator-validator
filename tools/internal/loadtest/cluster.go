package loadtest

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

const (
	// Chart is the chart both commands deploy, and Namespace the namespace they deploy into.
	// The release is deliberately left behind for inspection; `helm uninstall load -n load`
	// when done.
	Chart     = "charts/yaml-config-generator-validator"
	Namespace = "load"
	Release   = "load"
	// FortioImage is pinned so a re-run measures the same client, not a newer one.
	FortioImage = "docker.io/fortio/fortio:1.75.3"
)

// DeploymentName is the Deployment the chart renders for release "load".
const DeploymentName = "load-yaml-config-generator-validator"

// ServiceURL is the in-cluster URL a fortio pod loads.
func ServiceURL(path string) string {
	return "http://" + DeploymentName + path
}

// Run executes a command and returns its combined output, so a failure can be reported with
// whatever the tool actually said.
func Run(name string, args ...string) (string, error) {
	var buf bytes.Buffer
	cmd := exec.Command(name, args...)
	cmd.Stdout = &buf
	cmd.Stderr = &buf
	err := cmd.Run()
	return buf.String(), err
}

// Install deploys the chart with the given --set/--set-json arguments and waits for it.
func Install(extra []string) error {
	args := append([]string{
		"upgrade", "--install", Release, Chart,
		"--namespace", Namespace, "--create-namespace",
		"--set", "image.repository=localhost/ycgv",
		"--set", "image.tag=load",
		"--set", "image.pullPolicy=Never",
		"--set", "replicaCount=1",
	}, extra...)
	args = append(args, "--wait", "--timeout", "120s")

	if out, err := Run("helm", args...); err != nil {
		return fmt.Errorf("helm upgrade failed: %w\n%s", err, out)
	}
	if out, err := Run("kubectl", "-n", Namespace, "rollout", "status",
		"deploy/"+DeploymentName, "--timeout=120s"); err != nil {
		return fmt.Errorf("rollout did not complete: %w\n%s", err, out)
	}
	return nil
}

// LimitsArg builds the resources.limits argument.
//
// `--set resources.limits.cpu=null` writes a literal 0 in Helm 4, which the API server rejects
// as "requests must be <= limit of 0". Replacing the whole limits map is what avoids that, so
// "no CPU limit" is expressed by leaving the key out rather than nulling it.
func LimitsArg(cpu, memory string) []string {
	if cpu == "" || cpu == "none" {
		return []string{"--set-json", fmt.Sprintf(`resources.limits={"memory":%q}`, memory)}
	}
	return []string{"--set-json", fmt.Sprintf(`resources.limits={"cpu":%q,"memory":%q}`, cpu, memory)}
}

// PodName returns the name of the release's single pod, or "" when it cannot be read.
func PodName() string {
	out, err := Run("kubectl", "-n", Namespace, "get", "pod",
		"-l", "app.kubernetes.io/instance="+Release,
		"-o", "jsonpath={.items[0].metadata.name}")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(out)
}

// PodStatus returns the restart count and the last termination reason (OOMKilled shows up
// here), each as the raw jsonpath output, or "" when unreadable. The termination reason is what
// distinguishes "this memory limit was tight" from "this memory limit killed the pod".
func PodStatus() (restarts, terminated string) {
	restarts = jsonPath(`{range .items[*]}{.status.containerStatuses[0].restartCount}{" "}{end}`)
	terminated = jsonPath(`{range .items[*]}{.status.containerStatuses[0].lastState.terminated.reason}{" "}{end}`)
	return strings.TrimSpace(restarts), strings.TrimSpace(terminated)
}

func jsonPath(expression string) string {
	out, err := Run("kubectl", "-n", Namespace, "get", "pod",
		"-l", "app.kubernetes.io/instance="+Release, "-o", "jsonpath="+expression)
	if err != nil {
		return ""
	}
	return out
}

// Fortio runs one fortio load against the deployed service from inside the cluster.
//
// -httpbufferkb 1024 is load-bearing: fortio's default 128KiB read buffer is smaller than this
// app's JS bundle, so it aborts every response mid-read and opens a new socket. That shows up
// as ~50% "Code -1" and halves both throughput and latency accuracy, while looking like a
// server fault.
func Fortio(connections int, seconds int, qps string, url string) string {
	name := fmt.Sprintf("fortio-%d", time.Now().UnixNano()%100000)
	out, _ := Run("kubectl", "-n", Namespace, "run", name,
		"--rm", "-i", "--restart=Never", "--quiet", "--image="+FortioImage, "--",
		"load", "-c", fmt.Sprint(connections), "-t", fmt.Sprintf("%ds", seconds),
		"-qps", qps, "-httpbufferkb", "1024", url)
	return out
}

// Sample polls `kubectl top pod` until the context is cancelled, returning everything it read.
// The caller cancels when the load run finishes, so the samples cover exactly the load window.
func Sample(ctx context.Context, pod string, every time.Duration) string {
	var samples strings.Builder
	for {
		if out, err := Run("kubectl", "-n", Namespace, "top", "pod", pod, "--no-headers"); err == nil {
			samples.WriteString(out)
		}
		select {
		case <-ctx.Done():
			return samples.String()
		case <-time.After(every):
		}
	}
}

// ClusterReachable reports whether kubectl has a cluster to talk to at all, so both commands
// can say so rather than failing several steps later.
func ClusterReachable() bool {
	_, err := Run("kubectl", "cluster-info")
	return err == nil
}
