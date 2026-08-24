# Running as a container

`Containerfile` builds an OCI image that serves the built static site from nginx.
It's an alternative to [GitHub Pages](deploying-to-github-pages.md) for anyone who
needs to host this behind their own network — the app itself is unchanged (no
backend, no server-side anything; nginx only hands out the files Vite produced).

The image is ~15 MB and runs as UID 101 with a read-only root filesystem and no
capabilities.

## Build

```sh
buildah bud -t yaml-config-generator-validator:local .
```

`podman build` and `docker build` accept the same file and produce the same image —
the Containerfile sticks to plain OCI-compatible instructions (no `# syntax=`
directive, no `RUN --mount` cache mounts, no `HEALTHCHECK`), so nothing depends on
BuildKit or on Docker-format images.

To stamp the [OCI annotations](https://github.com/opencontainers/image-spec/blob/main/annotations.md)
that can't be hardcoded, pass them in:

```sh
buildah bud \
  --build-arg IMAGE_CREATED="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg IMAGE_REVISION="$(git rev-parse HEAD)" \
  --build-arg IMAGE_VERSION="$(git describe --tags --always)" \
  -t yaml-config-generator-validator:local .
```

Buildah writes OCI-format images by default (`--format oci`); `docker build` writes
Docker-format ones. Both are fine here — the image has no format-specific fields.

## Run

```sh
podman run --rm -p 8080:8080 \
  --read-only --tmpfs /tmp \
  --cap-drop=ALL --security-opt=no-new-privileges \
  yaml-config-generator-validator:local
```

Then open `http://localhost:8080`. `--read-only` works because
`nginx-unprivileged` keeps every temp path under `/tmp`; nothing in the image is
written at runtime.

There's a `/healthz` endpoint returning `200 ok` for liveness/readiness probes.

## What's in the Containerfile, and why

- **Two stages.** The `node` builder runs `npm ci` + `npm run build`; only
  `/app/dist` is copied into the runtime stage, so neither `node_modules` nor the
  Node runtime itself ships in the final image.
- **Digest-pinned bases**, tag kept alongside for readability — same rule as every
  `uses:` in `.github/workflows` (see [supply chain security](supply-chain-security.md)).
  Renovate bumps both together (`dockerfile` manager, grouped weekly; digest-only
  re-pins automerge, since the CI below actually builds and tests the new base).
- **`npm ci --ignore-scripts`** — no dependency lifecycle script runs at build time.
  Nothing in this tree needs one.
- **Lockfile copied before the source**, so editing a component doesn't invalidate
  the install layer.
- **Non-root in both stages** — `USER 1000:1000` (the `node` user) for the build,
  `USER 101:101` for the runtime (already the base image's default, restated
  numerically so Kubernetes' `runAsNonRoot` can verify it without a name lookup, so it
  survives a base image rename, and because hadolint's DL3066 flags name-based UIDs).
- **`dist/` stays root-owned** in the runtime stage: nginx reads it as UID 101 and
  never writes it, so a compromised process can't rewrite its own web root.
- **Port 8080**, not 80 — binding a privileged port would need `CAP_NET_BIND_SERVICE`.
- **`STOPSIGNAL SIGQUIT`** — nginx drains in-flight requests on SIGQUIT and drops
  them on SIGTERM.
- **No `HEALTHCHECK`** — it's a Docker-format extension with no equivalent field in
  the OCI image spec, and buildah drops it unless you build `--format docker`. Probe
  `/healthz` from the orchestrator instead.

`container/nginx.conf` (mounted at `/etc/nginx/conf.d/default.conf`) adds security
headers, long-lived caching for Vite's fingerprinted `/assets/` plus `no-cache` for
`index.html`, gzip, and the health endpoint. Its CSP allows `connect-src
https://api.github.com` — that's the app's whole GitHub integration
(`src/lib/github.ts`); tighten or drop it only alongside that code.

`.containerignore` keeps `node_modules`, `dist`, `.git` and local scan output out of
the build context. buildah and podman read it directly; `docker build` only looks for
`.dockerignore`, so on Docker either `ln -s .containerignore .dockerignore` or accept
the larger context. There's deliberately no second checked-in copy to drift out of
sync.

## What CI does with it

`.github/workflows/container.yml` runs on every push to `main` and every PR. Nothing
about the site's own delivery depends on it — the app ships via
[GitHub Pages](deploying-to-github-pages.md) — but without it the container path would
rot silently.

| Job | Tool | License | What it does |
|---|---|---|---|
| `hadolint` | [hadolint](https://github.com/hadolint/hadolint) | GPL-3.0 | Lints the Containerfile itself: missing `USER`, unpinned bases, name-based UIDs, shell anti-patterns in `RUN`. SARIF → **Security → Code scanning** + artifact. |
| `build` | buildah + podman (runner-preinstalled) | Apache-2.0 | Builds `--format oci` with commit-derived timestamps, then **runs** the image locked down exactly as documented above and asserts it works: `/healthz`, the real page, the SPA fallback, UID 101, and every security header `container/nginx.conf` sets (including no nginx version banner). Exports the tested image as an OCI archive for the jobs below, and generates a CycloneDX SBOM of it with Syft. |
| `scan` | [Trivy](https://github.com/aquasecurity/trivy) | Apache-2.0 | Scans the built image for OS/language CVEs, embedded secrets and misconfiguration. Reports everything as SARIF; fails only on **fixable** HIGH/CRITICAL, so unfixed advisories stay visible without permanently reddening the build. |
| `sca` | [OSV-Scanner](https://github.com/google/osv-scanner) | Apache-2.0 | Second, independent vulnerability pass over the image SBOM, through the same `osv-scan.yml` reusable workflow the npm tree uses. Different database, different engine — same reasoning as the two SCA passes in [supply chain security](supply-chain-security.md). |
| `publish` | skopeo + `actions/attest*` | Apache-2.0 | **`main` only**, and only if every job above passed: pushes the exact archive that was smoke-tested to `ghcr.io/wdalmeida/yaml-config-generator-validator` (no rebuild), then attaches SLSA build provenance and the SBOM as Sigstore-signed attestations, pushed to the registry alongside the image. |

Every tool is installed as a checksum-verified binary release rather than through a
wrapper action — the same reasoning that rules out `anchore/sbom-action` for Syft
(a SHA-pinned action can still fetch an unpinned binary at runtime; see
[supply chain security](supply-chain-security.md)).

The image is published as a GHCR package on the repo. Packages start private even on a
public repo — make it public under **Packages → Package settings** if it should be
pullable anonymously. To stop publishing entirely, delete the `publish` job; the rest of
the workflow keeps working as a pure check.

## Pulling and verifying a published image

```sh
podman pull ghcr.io/wdalmeida/yaml-config-generator-validator:latest

# Provenance: who built this digest, from which commit and workflow
gh attestation verify \
  oci://ghcr.io/wdalmeida/yaml-config-generator-validator:latest \
  --repo wdalmeida/yaml-config-generator-validator
```

`gh attestation verify` checks the Sigstore signature and the SLSA provenance predicate
against this repository — an image someone else rebuilt and pushed under the same tag
fails that check.

## Deliberately not done

- **Multi-arch (`linux/arm64`) images.** Would need `buildah manifest` plus QEMU
  emulation for the Node build — minutes of CI time for a use case nobody has asked for
  yet. Add it when someone actually needs an arm64 image.
- **A `HEALTHCHECK` instruction** — see above; `/healthz` covers it portably.
- **Signing with cosign directly.** The GitHub attestations are Sigstore-backed and
  registry-pushed already; a second signing path would be one more key story for no
  extra guarantee here.
