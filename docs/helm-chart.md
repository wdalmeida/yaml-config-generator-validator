# Deploying with Helm

`charts/yaml-config-generator-validator/` deploys the [container image](container.md) into a
Kubernetes cluster. It's a third way to host this, alongside
[GitHub Pages](deploying-to-github-pages.md) and running the container directly — the app
itself is identical in all three (no backend, no server-side anything; nginx hands out the
files Vite produced).

## Install

```sh
helm install ycgv ./charts/yaml-config-generator-validator \
  --namespace yaml-config --create-namespace
```

```sh
# or against a published chart archive
helm package ./charts/yaml-config-generator-validator
helm install ycgv ./yaml-config-generator-validator-0.1.0.tgz -n yaml-config --create-namespace
```

Nothing is required in `values.yaml` for a working install. There is no application
configuration to supply, because there is none to supply: everything the app does is decided
at `npm run build` time and shipped inside the image.

## What it creates

| Resource | Always? | Notes |
|---|---|---|
| Deployment | yes | 2 replicas, rolling update with `maxUnavailable: 0` |
| Service | yes | ClusterIP :80 → container :8080 |
| ServiceAccount | `serviceAccount.create` (default on) | token **not** mounted |
| Ingress | `ingress.enabled` | off by default |
| HorizontalPodAutoscaler | `autoscaling.enabled` | off; replaces `replicaCount` when on |
| PodDisruptionBudget | `podDisruptionBudget.enabled` | off |
| NetworkPolicy | `networkPolicy.enabled` | off; deny-all egress when on |

## The security posture, and why each piece

The pod runs with no capabilities, no privilege escalation, a read-only root filesystem, the
`RuntimeDefault` seccomp profile, and no ServiceAccount token. None of that is aspirational —
the image was built to be run this way, and `container.yml`'s smoke test already runs it under
the equivalent `podman` flags on every push.

Two choices are worth spelling out, because they look like omissions:

**There is no `runAsUser`.** Both images declare a numeric non-root user in their own config
(101 for the Alpine image, 65532 for the Red Hat one), so `runAsNonRoot: true` is enforceable
without the chart having to know which image you pointed it at — the kubelet reads the answer
from the image and refuses to start a container that would be root. Pinning a UID here would
also break the chart on OpenShift, where the `restricted-v2` SCC assigns its own UID from the
namespace's range and rejects a pod that asks for a specific one. Set it in
`podSecurityContext` if your own policy requires it.

**`/tmp` is an `emptyDir`, and it is the only writable path.** nginx keeps its pid file and
every temp path there and writes nowhere else, which is exactly what makes
`readOnlyRootFilesystem: true` viable rather than aspirational. `tmpVolume.sizeLimit` (16Mi by
default) bounds it; real usage is a few hundred KB.

## Deploying the Red Hat image

Only the Alpine image is published (see [the container doc](container.md) for why — neither
vulnerability scanner in this repo's CI can read the Project Hummingbird one yet). To run that
variant, build it, push it somewhere you control, and point the chart at it:

```sh
buildah bud -f Containerfile.redhat -t registry.example.com/yaml-config-generator-validator:redhat .
podman push registry.example.com/yaml-config-generator-validator:redhat
helm upgrade --install ycgv ./charts/yaml-config-generator-validator \
  --set image.repository=registry.example.com/yaml-config-generator-validator \
  --set image.tag=redhat
```

**No other value changes.** That image runs as `65532:0` rather than `101:101`, and because
the chart pins no UID, it just works — verified, not assumed: the rollout below was done both
ways against a real cluster.

## Pinning the image

`image.tag` defaults to the chart's `appVersion`, which is `latest`, which is a moving tag.
Set `image.digest` for anything you care about:

```yaml
image:
  digest: "sha256:..."
```

A digest is also the only form the image's Sigstore provenance and SBOM attestations can be
verified against — `gh attestation verify` against a tag verifies whatever that tag points at
today, which is not the same promise. `NOTES.txt` prints the command after every install.

Note that GHCR packages start private even on a public repo, so a fresh install may sit in
`ImagePullBackOff` until the package is made public or `imagePullSecrets` names a secret.

## Ingress, including under a sub-path

Serving at a sub-path works, because `vite.config.ts` sets `base: './'` — every asset URL in
`index.html` is relative, so it resolves against whatever prefix the browser is on. What it
needs from the ingress is a **rewrite to `/`**, since the container serves the site at its
root:

```yaml
ingress:
  enabled: true
  className: nginx
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
  hosts:
    - host: tools.example.com
      paths:
        - path: /yaml
          pathType: Prefix
```

Without the rewrite the controller forwards `/yaml/` to nginx, whose SPA fallback answers
every path with `index.html` — including the asset paths — and the page loads blank.

## The NetworkPolicy says something true

`networkPolicy.enabled=true` writes down what the image already does: accept HTTP on the
container port, and make no outbound connection at all. Not even DNS — nginx here has no
`resolver` directive and proxies nothing. The GitHub API calls this app makes are made by the
*browser*, not by the pod, so a deny-all egress rule costs the app nothing.

It's off by default for an honest reason: a cluster whose CNI doesn't implement NetworkPolicy
accepts the object and silently ignores it, and a rule you believe is enforced but isn't is
worse than no rule at all.

## What CI checks

`ci.yml`'s `helm` job runs three tools, each answering a different question:

| Tool | Question |
|---|---|
| `helm lint` | is this a well-formed chart? |
| [kubeconform](https://github.com/yannh/kubeconform) `-strict` | is each rendered manifest a **valid** Kubernetes object? |
| [kube-linter](https://github.com/stackrox/kube-linter) | is it a **sensible** one? |

`helm lint` alone passes a Deployment with a misspelled field quite happily, which is what
kubeconform catches. kubeconform in turn is perfectly happy with a valid object that runs as
root — that is kube-linter's job. Its findings go to **Security → Code scanning** as SARIF
plus a downloadable artifact, like every other scanner here.

All three are version-pinned and verified at install time, and Renovate bumps them in the
"workflow tool versions" group. kube-linter is the one exception to "checksum-verified": it
publishes no checksums file, only per-asset Sigstore bundles, and those are bare blob
signatures rather than SLSA provenance, so `gh attestation verify` cannot consume them.
GitHub's release API does report each asset's sha256 — the same trust root a `checksums.txt`
in the release would have had, and with the useful property of tracking a version bump on its
own — so that is what the install step verifies against.

### The two kube-linter exclusions

`.kube-linter.yaml` turns off exactly two default checks, both documented in the file itself:

- **`latest-tag`** — the default `image.tag` resolves to `appVersion`, which is `latest`,
  because the app has no tagged release yet. Hardcoding a digest as the *default* would give
  a chart that silently rots between releases: a visible weakness traded for an invisible one.
  The digest path is real and is rendered by `ci/everything-values.yaml`.
- **`no-anti-affinity`** — the check looks specifically for `podAntiAffinity`. The chart uses
  `topologySpreadConstraints`, which is the newer mechanism for the same goal; satisfying the
  check literally would mean carrying a redundant second spreading rule.

A third, `non-existent-service-account`, is excluded as an artifact of the test fixtures: a
lint over rendered manifests has no cluster in which to find a pre-existing ServiceAccount,
which is exactly what `ci/autoscaling-values.yaml` sets up on purpose.

Nothing else is suppressed. kube-linter found one genuine bug while this chart was being
written — a PodDisruptionBudget with no `unhealthyPodEvictionPolicy`, which can hold a node
drain open indefinitely when the pods it protects are the unhealthy ones — and that was fixed
rather than excluded (`podDisruptionBudget.unhealthyPodEvictionPolicy`, `AlwaysAllow` by
default, needs Kubernetes 1.27+).

Every values file under `charts/*/ci/*-values.yaml` is rendered too, not just the defaults:
`everything-values.yaml` turns on Ingress, HPA, PDB and NetworkPolicy at once, and
`autoscaling-values.yaml` takes the other branch of each either/or (autoscaling on so
`replicas` must be omitted, a ServiceAccount the chart doesn't create, a name override, a
non-ClusterIP Service). Without those, a template that only breaks when an optional feature is
enabled would reach `main` untested.

Run the same thing locally with `just helm`.

## Verified how

Static checks are not enough to claim a chart works, so this one was also installed into a
real cluster (`kind`, Kubernetes v1.37) before being committed:

- both replicas Ready with 0 restarts, serving the SPA and the SPA fallback through the
  Service, with all three security headers intact;
- the runtime pod spec carrying `runAsNonRoot`, `readOnlyRootFilesystem`,
  `capabilities.drop: [ALL]`, `seccompProfile: RuntimeDefault` and
  `automountServiceAccountToken: false`;
- a `helm upgrade` from the Alpine image to the Red Hat one, rolling out cleanly with no value
  changes and no restarts — the check that matters for the no-`runAsUser` decision;
- pods Ready ~1s after start, which is why there is no `startupProbe`;
- both CI values files applied against a live API server with `kubectl apply
  --dry-run=server`, so the Ingress, HPA, PDB and NetworkPolicy are known to be accepted by
  admission and not merely schema-valid.

A single `Unhealthy` event per pod at startup is normal and harmless: the kubelet's first
readiness probe can beat nginx to the port by a few hundred milliseconds.

The kube-linter gate was checked the other way round too, so that a passing run means
something: rendering the chart with `--set securityContext=null --set podSecurityContext=null`
produces `run-as-non-root` and `no-read-only-root-fs` findings and exit code 1.

## Sizing, measured

The defaults in `values.yaml` are load-tested, not guessed. Reproduce any of this with
`just loadtest` (see [the script](../scripts/helm-loadtest.sh) for what it does).

**Method.** One replica, `fortio` driving load from inside the cluster, on a single-node
`kind` cluster (Kubernetes v1.37) with 4 CPUs and ~2 GiB. Two workloads: the 484-byte
`index.html`, and the ~500 KB JS bundle that **every real page load fetches**. The load
generator shares the node with the server, so treat the absolute throughput figures as a
floor rather than a capacity rating; the shape of each curve, and where things break, is
what transfers.

### Memory: 64Mi is a cliff, not a slope

100 concurrent fetches of the JS bundle, no CPU limit:

| Memory limit | req/s | p50 | p99 | Result |
|---|---|---|---|---|
| 32Mi | 2,805 | 4.86 ms | 1585 ms | **OOMKilled twice, 46,995 failed requests** |
| 64Mi | 18,541 | 0.81 ms | 43 ms | clean |
| 128Mi | 19,431 | 0.81 ms | 41.6 ms | clean, peak working set 36Mi |

**The trap here is that steady-state memory is about 5Mi.** Measure the small-page workload
alone and the container looks like it fits in 8Mi — it survived over a million requests at a
**4Mi** limit. Size on that number and it OOMKills the first time real browsers pull the
bundle concurrently. The gap is transient buffer demand while streaming a large file to many
connections, which no steady-state reading shows you.

Above 64Mi the extra memory buys ~5% throughput and nothing else, so 128Mi is the knee plus
headroom rather than a number picked for comfort — **at this concurrency**. It does not hold
at 1 000 connections; see the capacity section below.

### CPU: starvation degrades, it doesn't kill

16 concurrent fetches of the JS bundle, 128Mi:

| CPU limit | req/s | p50 | p99 |
|---|---|---|---|
| none | 20,729 | 0.63 ms | 7.5 ms |
| 250m | 5,042 | 0.69 ms | 75 ms |
| 100m | 847 | 0.97 ms | 182 ms |
| 50m | 332 | 1.41 ms | 376 ms |
| 20m | 125 | **91 ms** | 789 ms |

Every one of those runs served every request: zero errors, zero restarts. CPU pressure is
throttling, and throttling is survivable — which is exactly why the chart sets **no CPU
limit** and does set a memory one. Under-provision CPU and you get a slower site; under-provision
memory and the kernel kills the container mid-response.

Note how the cost lands almost entirely on the tail. Median latency is flat from unlimited
down to 50m; p99 rises 50× over the same range, because CFS lets nginx burst through its
quota early in each 100 ms period and then stalls. At 20m even the median collapses, which is
where it stops being usable under sustained load.

If your platform requires a CPU limit, 250m keeps p99 under 100 ms here. Below 100m, expect
tail latency in the hundreds of milliseconds under load.

### What this means for a small deployment

A page load is roughly four requests (HTML, JS, CSS, icon). Even at a **50m** limit — one
twentieth of a core — a single replica served ~330 bundle fetches a second, and the default
two replicas idle at around 5Mi and near-zero CPU. For a team-sized audience the defaults are
far more than enough; the reason not to shrink them further is the memory cliff above, not
throughput.

> The full run — every concurrency level, both charts, and the reasoning — is written up in
> [the capacity report](capacity-report.md), with an interactive version in
> [`capacity-report.html`](capacity-report.html).

### If your platform mandates a CPU limit too

The chart limits memory and not CPU, for the reasons above. Plenty of platforms don't allow
that. With both limits set, this is what one replica does across the concurrency range —
20 s at max rate against the JS bundle, memory 128Mi, measured with
`scripts/helm-capacity.sh`:

| Limite CPU | 1 connexion | 10 connexions | 100 connexions | 1 000 connexions |
|---|---|---|---|---|
| 100m | 1 814 req/s | 961 req/s | 1 269 req/s | 1 221 req/s |
| 250m | 6 404 req/s | 4 405 req/s | 6 066 req/s | 5 613 req/s |
| 500m | 8 552 req/s | 14 946 req/s | 15 619 req/s | 13 057 req/s |
| 1 000m | 8 688 req/s | 23 409 req/s | 25 393 req/s | **16 051 req/s, OOMKilled** |

**The balance point for high concurrency is `cpu: 500m` / `memory: 256Mi`**, which is what
`ci/both-limits-values.yaml` carries. Doubling 500m to 1 000m buys 23% more throughput
(13 057 → 16 051 req/s) where 250m → 500m more than doubles it, so it is the worst-value step
on the curve — and it is the only configuration in the campaign the kernel killed.

Two results from that table are worth more than the numbers themselves:

**More CPU can be what kills you on memory.** The only OOMKill came at the *highest* CPU
limit. A faster pod holds more responses in flight, and each one costs buffers: at 1 000
connections, 128Mi was killed in 4 runs out of 5 at 1 000m, while 500m never died at the same
limit. 256Mi survived 3 runs out of 3. The two limits are not independent dials, which is the
opposite of how they are usually set.

**One connection cannot use more than about 500m.** Throughput at a single connection
plateaus at ~8 600 req/s no matter how much CPU you grant (8 552 at 500m, 8 688 at 1 000m),
because a connection waits for each response before sending the next. Concurrency is what
converts CPU into throughput; a capacity number quoted without a concurrency figure beside it
means very little.

At 100m the curve is not even monotonic — 1 814 req/s at one connection, 961 at ten. Under a
tight quota, extra concurrency costs more in throttling and context-switching than it returns.

### Sizing by target concurrency

The cheapest limits that don't cost you latency, per level. Requests stay at `cpu: 10m` /
`memory: 32Mi` throughout — those are what the cluster actually reserves, and the pod idles
near zero.

| Connections | `limits.cpu` | `limits.memory` | Throughput | p99 | Why this pair |
|---|---|---|---|---|---|
| 1 | 250m | 64Mi | 6 404 req/s | 1.0 ms | More CPU changes nothing: one connection plateaus at ~8 600 req/s. 100m would cost 11× the p99 (11.3 ms). |
| 10 | 500m | 64Mi | 14 946 req/s | 4.2 ms | Dropping to 250m costs 3.4× the throughput and 18× the p99 (76.7 ms). |
| 100 | 500m | 128Mi | 15 619 req/s | 55.8 ms | 64Mi is the measured floor and peak working set is 36 Mi, so 128Mi is the first comfortable step. |
| 1 000 | 500m | 256Mi | 13 057 req/s | 582.9 ms | 128Mi was OOMKilled in 4 runs of 5 here, and 1 000m is the limit that triggers it. |

Two things this table is not saying:

- **The memory column is a floor plus margin, not a target.** 64Mi is measured clean at 100
  connections, which bounds everything below it; only the 1 000-connection row was measured
  separately, because that is where 128Mi fails.
- **500m is the right CPU for almost everything.** It appears in three rows out of four. Below
  it the tail degrades sharply; above it, throughput per millicore falls off a cliff — 500m to
  1 000m buys 23% at 1 000 connections, and is the only setting that got OOMKilled.

### Connections are not requests

Worth stating because every number above depends on it. `-c 1000` means a thousand sockets
held open at once; req/s counts requests served across all of them. HTTP keepalive means one
socket carries thousands of sequential requests — measured directly in one run:

```text
Sockets used: 4 (for perfect keepalive, would be 4)
Code 200 : 305 370 (100.0 %)
```

Four connections, 305 370 requests. So at 1 000 connections and 16 051 req/s, each connection
is receiving about 16 req/s — one request every ~62 ms. A concurrent *user* is different
again: a browser opens around six connections per host, a cold page load is about four
requests, and a reader spends most of their time not fetching anything. 1 000 held-open
connections is far more traffic than 1 000 people on the site.

### One thing you cannot tune from the chart

nginx runs `worker_processes auto`, which means **one worker per node CPU, not per CPU
limit**. With a 100m limit on this 4-CPU node it still forked four workers; on a 64-core node
it would fork 64, and memory overhead grows with them. The base image ships an autotune script
for precisely this, and it cannot work here — it rewrites `/etc/nginx/nginx.conf`, which
`readOnlyRootFilesystem: true` forbids, and says so:

```text
30-tune-worker-processes.sh: error: can not modify /etc/nginx/nginx.conf (read-only file system?)
```

Setting `NGINX_ENTRYPOINT_WORKER_PROCESSES_AUTOTUNE=1` in `env` therefore does nothing except
log that error. On a large node, raise `resources.limits.memory` rather than trying to tune
the worker count; pinning it properly means baking `worker_processes` into a derived image.

### Two measurement mistakes worth knowing about

Both of these produced confident, wrong numbers before they were caught, and both are easy to
repeat:

- **fortio's default read buffer is 128 KiB**, which is smaller than this app's JS bundle. It
  aborts each response mid-read and opens a fresh socket, reporting ~50% `Code -1` that looks
  like a server fault. Throughput came out half what it really was and p50 nine times worse.
  `-httpbufferkb 1024` fixes it; `Sockets used: 4 (for perfect keepalive, would be 4)` is the
  line that confirms it.
- **`grep -E '^Code [0-9]+'` never matches `Code  -1`** — two spaces, a minus sign. An error
  check written that way reports every run as clean no matter what happened.

## Deliberately not done

- **Publishing the chart** (to an OCI registry or a `gh-pages` chart repo). It installs from a
  path or a `helm package` archive today. Publishing is a release process and a versioning
  promise, not a template change.
- **`helm test` hooks.** A test pod would need a second image with a shell and curl in it,
  which is a supply-chain decision for the sake of asserting what the CI smoke test already
  asserts against the same image.
- **TLS termination in the pod.** That belongs at the ingress or the mesh; the container
  listens on plain HTTP on 8080 by design.
- **ConfigMap-driven nginx config.** `container/nginx.conf` is baked into the image and is
  covered by the container smoke test. Making it a values-driven ConfigMap would let a
  deployment silently diverge from the thing CI verifies.
