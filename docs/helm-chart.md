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

`ci.yml`'s `helm` job runs `helm lint` and then renders the chart and pipes every manifest
through [kubeconform](https://github.com/yannh/kubeconform) (`-strict`) against the real
Kubernetes API schemas. `helm lint` alone only inspects the chart's own structure — it passes
a Deployment with a misspelled field quite happily, which is the mistake kubeconform catches.

Both tools are checksum-verified binaries, the same pattern as every other tool in these
workflows, and Renovate bumps both in the "workflow tool versions" group.

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
