#!/usr/bin/env bash
# One load-test run against the Helm chart, inside whatever cluster kubectl currently points
# at. This is a manual tool - nothing in CI runs it, because it needs a cluster and several
# minutes - but every resource number in docs/helm-chart.md and charts/*/values.yaml came out
# of it, and those numbers are only worth trusting if you can reproduce them.
#
#   just loadtest                                  # the default sweep
#   scripts/helm-loadtest.sh <label> <cpu-request> <cpu-limit|none> <mem-limit> \
#                            <connections> <seconds> [path]
#
# Two things it gets right that are easy to get wrong, both of which produced wrong answers
# here before they were fixed:
#
#   -httpbufferkb 1024 - fortio's default 128KiB read buffer is smaller than this app's JS
#   bundle, so it aborts every response mid-read and opens a new socket. That shows up as
#   ~50% "Code -1" and halves both throughput and latency accuracy, while looking like a
#   server fault.
#
#   The non-200 grep matches "Code  -1" (two spaces, a minus sign) as well as "Code 503".
#   A regex of ^Code [0-9]+ silently reports every run as clean.
#
# It deploys into the "load" namespace and leaves the release behind for inspection;
# `helm uninstall load -n load` when done.
set -uo pipefail
label="$1"; cpu_req="$2"; cpu_lim="$3"; mem_lim="$4"; conns="$5"; dur="$6"; path="${7:-/}"
CHART=charts/yaml-config-generator-validator
NS=load

args=(
  --namespace "$NS" --create-namespace
  --set image.repository=localhost/ycgv --set image.tag=load --set image.pullPolicy=Never
  --set replicaCount=1
  --set resources.requests.cpu="$cpu_req"
  --set resources.requests.memory=16Mi
)
# --set resources.limits.cpu=null writes a literal 0 in Helm 4, which the API server rejects
# as "requests must be <= limit of 0". Replace the whole limits map instead.
if [ "$cpu_lim" = none ]; then
  args+=(--set-json "resources.limits={\"memory\":\"${mem_lim}\"}")
else
  args+=(--set-json "resources.limits={\"cpu\":\"${cpu_lim}\",\"memory\":\"${mem_lim}\"}")
fi

helm upgrade --install load "$CHART" "${args[@]}" --wait --timeout 120s >/dev/null 2>&1
kubectl -n "$NS" rollout status deploy/load-yaml-config-generator-validator --timeout=120s >/dev/null 2>&1
pod="$(kubectl -n "$NS" get pod -l app.kubernetes.io/instance=load -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)"
url="http://load-yaml-config-generator-validator${path}"

samples="$(mktemp)"
( for _ in $(seq 1 25); do kubectl -n "$NS" top pod "$pod" --no-headers 2>/dev/null; sleep 2; done ) > "$samples" &
sampler=$!

out="$(kubectl -n "$NS" run "fortio-$RANDOM" --rm -i --restart=Never --quiet \
  --image=docker.io/fortio/fortio:1.75.3 -- \
  load -c "$conns" -t "${dur}s" -qps 0 -httpbufferkb 1024 "$url" 2>&1)"

kill "$sampler" 2>/dev/null; wait "$sampler" 2>/dev/null

qps="$(grep -oE '^Ended after .* qps=[0-9.]+' <<<"$out" | grep -oE 'qps=[0-9.]+' | cut -d= -f2)"
p50="$(grep -E '^# target 50%' <<<"$out" | head -1 | awk '{printf "%.2f", $4*1000}')"
p99="$(grep -E '^# target 99%' <<<"$out" | head -1 | awk '{printf "%.2f", $4*1000}')"
ok="$(grep -oE '^Code 200 : [0-9]+' <<<"$out" | awk '{print $4}')"
bad="$(grep -oE '^Code +-?[0-9]+ : [0-9]+' <<<"$out" | grep -vE '^Code +200' | tr '\n' ' ')"
peak_cpu="$(awk '{gsub(/m$/,"",$2); if ($2+0>c) c=$2+0} END {printf "%dm", c}' "$samples")"
peak_mem="$(awk '{gsub(/Mi$/,"",$3); if ($3+0>m) m=$3+0} END {printf "%dMi", m}' "$samples")"
restarts="$(kubectl -n "$NS" get pod -l app.kubernetes.io/instance=load -o jsonpath='{range .items[*]}{.status.containerStatuses[0].restartCount}{" "}{end}' 2>/dev/null)"
term="$(kubectl -n "$NS" get pod -l app.kubernetes.io/instance=load -o jsonpath='{range .items[*]}{.status.containerStatuses[0].lastState.terminated.reason}{" "}{end}' 2>/dev/null | tr -s ' ')"
rm -f "$samples"

printf '%-14s req=%-5s lim=%-5s mem=%-6s c=%-3s | %9s req/s | p50 %6sms p99 %6sms | peak %5s %6s | 200s=%-8s restarts=%s %s\n' \
  "$label" "$cpu_req" "$cpu_lim" "$mem_lim" "$conns" "${qps:-ERR}" "${p50:-?}" "${p99:-?}" \
  "${peak_cpu:-?}" "${peak_mem:-?}" "${ok:-0}" "${restarts:-?}" "${bad:+ERRORS: $bad}${term:+ LAST_TERM=$term}"
