#!/usr/bin/env bash
# Capacity of one replica with BOTH limits set - for platforms that mandate a CPU limit as
# well as a memory one, where scripts/helm-loadtest.sh's "no CPU limit" default isn't an
# option. Reports saturation throughput and latency percentiles for one (cpu, memory,
# concurrency) point; docs/helm-chart.md has the matrix these produced.
#
#   scripts/helm-capacity.sh <cpu-limit> <mem-limit> <connections> <path> [fixed-qps]
#   scripts/helm-capacity.sh 500m 256Mi 1000 /assets/index-abc123.js
#
# Manual, like helm-loadtest.sh: it needs a cluster, an image the cluster can pull, and a few
# minutes per point. Connections are not requests - one keepalive connection carries many
# sequential requests, so <connections> is how many sockets are held open, not a rate.
set -uo pipefail
cpu_lim="$1"; mem_lim="$2"; conns="$3"; path="$4"; fixed="${5:-}"
CHART=charts/yaml-config-generator-validator
NS=load

helm upgrade --install load "$CHART" \
  --namespace "$NS" --create-namespace \
  --set image.repository=localhost/ycgv --set image.tag=load --set image.pullPolicy=Never \
  --set replicaCount=1 \
  --set resources.requests.cpu=10m --set resources.requests.memory=32Mi \
  --set-json "resources.limits={\"cpu\":\"${cpu_lim}\",\"memory\":\"${mem_lim}\"}" \
  --wait --timeout 120s >/dev/null 2>&1
kubectl -n "$NS" rollout status deploy/load-yaml-config-generator-validator --timeout=120s >/dev/null 2>&1

url="http://load-yaml-config-generator-validator${path}"
qps_arg="${fixed:-0}"

run_fortio() {
  kubectl -n "$NS" run "cap-$$-$RANDOM" --rm -i --restart=Never --quiet \
    --image=docker.io/fortio/fortio:1.75.3 -- \
    load -c "$conns" -t 20s -qps "$qps_arg" -httpbufferkb 1024 "$url" 2>&1
}
extract_qps() { grep -oE '^Ended after .* qps=[0-9.]+' <<<"$1" | grep -oE 'qps=[0-9.]+' | cut -d= -f2; }

out="$(run_fortio)"
qps="$(extract_qps "$out")"
# A run that produced no throughput line is a harness/scheduling hiccup, not a result - retry
# once and keep the raw output either way, rather than reporting a silent ERR.
if [ -z "$qps" ]; then
  sleep 5
  out="$(run_fortio)"
  qps="$(extract_qps "$out")"
fi
if [ -z "$qps" ]; then
  printf '%s\n' "$out" > "/tmp/capacity-fail-${cpu_lim}-${conns}.log"
  echo "  (raw output kept at /tmp/capacity-fail-${cpu_lim}-${conns}.log)" >&2
fi
p50="$(grep -E '^# target 50%' <<<"$out" | head -1 | awk '{printf "%.1f", $4*1000}')"
p90="$(grep -E '^# target 90%' <<<"$out" | head -1 | awk '{printf "%.1f", $4*1000}')"
p99="$(grep -E '^# target 99%' <<<"$out" | head -1 | awk '{printf "%.1f", $4*1000}')"
ok="$(grep -oE '^Code +200 : [0-9]+' <<<"$out" | awk '{print $4}')"
bad="$(grep -oE '^Code +-?[0-9]+ : [0-9]+' <<<"$out" | grep -vE '^Code +200' | tr '\n' ' ')"
restarts="$(kubectl -n "$NS" get pod -l app.kubernetes.io/instance=load -o jsonpath='{range .items[*]}{.status.containerStatuses[0].restartCount}{" "}{end}' 2>/dev/null)"
term="$(kubectl -n "$NS" get pod -l app.kubernetes.io/instance=load -o jsonpath='{range .items[*]}{.status.containerStatuses[0].lastState.terminated.reason}{" "}{end}' 2>/dev/null | tr -s ' ')"

printf 'cpu=%-6s mem=%-6s c=%-4s rate=%-6s | %9s req/s | p50 %7sms p90 %7sms p99 %8sms | 200=%-8s restarts=%s %s%s\n' \
  "$cpu_lim" "$mem_lim" "$conns" "${fixed:-max}" "${qps:-ERR}" "${p50:-?}" "${p90:-?}" "${p99:-?}" \
  "${ok:-0}" "${restarts:-?}" "${bad:+ERRORS: $bad}" "${term:+OOM/TERM: $term}"
