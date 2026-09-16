# Running as a container

There are two Containerfiles. Both build an OCI image that serves the built static
site from nginx, and both are an alternative to
[GitHub Pages](deploying-to-github-pages.md) for anyone who needs to host this behind
their own network — the app itself is unchanged (no backend, no server-side anything;
nginx only hands out the files Vite produced).

| | `Containerfile` | `Containerfile.redhat` |
|---|---|---|
| Build stage | `docker.io/library/node:24-alpine3.22` | `registry.access.redhat.com/hi/nodejs:24-builder` |
| Runtime stage | `docker.io/nginxinc/nginx-unprivileged:1.31-alpine-slim` | `registry.access.redhat.com/hi/nginx:1.30` |
| libc | musl | glibc |
| Image size | ~15 MB | ~53 MB |
| Runs as | UID 101, GID 101 | UID 65532, GID 0 |
| Shell in the runtime image | busybox `ash` | none — distroless |
| Advisory feed behind the CVE scans | Alpine secdb | Red Hat |
| Published to GHCR | yes — `:latest`, `:sha-<short>` | **no** — build it yourself, [see below](#what-the-scanners-can-and-cant-see) |

**Neither is the canonical one.** Pick by what your platform will accept:

- **`Containerfile`** if you want the smallest thing that works. Nothing about it is
  Alpine-specific beyond the base images.
- **`Containerfile.redhat`** if a RHEL lineage is a requirement rather than a
  preference — procurement rules, a FIPS story, "no musl", or a vulnerability
  management process built around Red Hat's advisories. Its bases are
  [Red Hat Hardened Images](https://hummingbird-project.io) (Project Hummingbird):
  minimal, distroless, non-root, rebuilt on an automated near-zero-CVE cadence. They
  come from `registry.access.redhat.com/hi/`, which needs no subscription and no
  `registry.redhat.io` login, and are redistributable under the UBI terms
  (`distribution-scope=public`). CI builds, runs and SBOMs it on every push, but does
  **not** publish it — read
  [what the scanners can and can't see](#what-the-scanners-can-and-cant-see) before you
  deploy it.

Everything below applies to both unless it says otherwise, and both serve the site from
the same `container/nginx.conf`.

## Build

```sh
buildah bud -t yaml-config-generator-validator:local .

# or the Red Hat build
buildah bud -f Containerfile.redhat -t yaml-config-generator-validator:redhat .
```

The `justfile` mirrors what CI does with either one — `just image-build` and
`just image-smoke` take a variant argument (`alpine`, the default, or `redhat`), and
`just image-scan` / `just image-sca` read whichever archive was built last.

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

Then open `http://localhost:8080`. `--read-only` works because every nginx temp path
points under `/tmp`; nothing in either image is written at runtime. (For the Alpine
image that's `nginx-unprivileged`'s own doing; the Red Hat one gets there via
`container/redhat-temp-paths.conf` — see below.)

There's a `/healthz` endpoint returning `200 ok` for liveness/readiness probes.

## What's in the Containerfiles, and why

These apply to both files:

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
- **Non-root in both stages** — for the Alpine build, `USER 1000:1000` (the `node`
  user) and `USER 101:101` for the runtime; for the Red Hat build, UID 65532 throughout.
  Each is already its base image's default, restated numerically so Kubernetes'
  `runAsNonRoot` can verify it without a name lookup, so it survives a base image
  rename, and because hadolint's DL3066 flags name-based UIDs.
- **`dist/` stays root-owned** in the runtime stage: nginx reads it as UID 101 and
  never writes it, so a compromised process can't rewrite its own web root.
- **Port 8080**, not 80 — binding a privileged port would need `CAP_NET_BIND_SERVICE`.
- **`STOPSIGNAL SIGQUIT`** — nginx drains in-flight requests on SIGQUIT and drops
  them on SIGTERM.
- **No `HEALTHCHECK`** — it's a Docker-format extension with no equivalent field in
  the OCI image spec, and buildah drops it unless you build `--format docker`. Probe
  `/healthz` from the orchestrator instead.

### Where the Red Hat build differs

Four things, each forced by the base images rather than chosen:

- **`USER 65532:0`, not `65532:65532`.** Hummingbird images follow the OpenShift
  convention where an arbitrary assigned UID still lands in the root group, and several
  of nginx's own directories are group-0 writable rather than owned by 65532. Pinning
  the group to 65532 builds an image that cannot start.
- **`container/redhat-temp-paths.conf`**, copied in as
  `/etc/nginx/conf.d/00-temp-paths.conf`. nginx creates every temp directory it might
  need at startup, and `hi/nginx` keeps them under `/var/lib/nginx/tmp`, owned by UID
  999 with mode 0770 — unwritable as 65532 even on a *writable* root filesystem, so the
  process dies with `[emerg] mkdir() "/var/lib/nginx/tmp/client_body" failed` before it
  binds a port. The five temp paths are repointed at `/tmp`, which is exactly what
  `nginx-unprivileged` already does in its own config, and why `container/nginx.conf` —
  shared verbatim by both images — needs none of it.
- **No `CMD`.** `hi/nginx` declares `ENTRYPOINT ["/usr/sbin/nginx"]` with a `CMD` that
  carries `-c /etc/nginx/nginx.conf -e /dev/stderr -g "daemon off;"`. Repeating the
  Alpine file's `CMD ["nginx", "-g", "daemon off;"]` would be *appended* to that
  entrypoint and the container would not start.
- **`COPY --from=build --chown=0:0`** for the web root. Both images deliberately keep
  `dist/` root-owned so the running container can't rewrite what it serves; here the
  files arrive from the build stage owned by 65532, which is also the runtime UID, so
  the ownership has to be reset explicitly rather than inherited.

The build stage, on the other hand, is *simpler* than the Alpine one: the `-builder`
tag (the variant that ships bash, dnf and npm — the plain `hi/nodejs` tag is distroless
and has no npm to build with) already owns `/app` as its non-root user, so there's no
`mkdir`/`chown` step and no `USER 0` anywhere in the file.

`container/nginx.conf` (mounted at `/etc/nginx/conf.d/default.conf`) adds security
headers, long-lived caching for Vite's fingerprinted `/assets/` plus `no-cache` for
`index.html`, gzip, and the health endpoint. Its CSP allows `connect-src
https://api.github.com` — that's the app's whole GitHub integration
(`src/lib/github.ts`); tighten or drop it only alongside that code.

`.containerignore` keeps `node_modules`, `dist`, `.git` and local scan output out of
the build context (and both Containerfiles, via `Containerfile*`). buildah and podman read it directly; `docker build` only looks for
`.dockerignore`, so on Docker either `ln -s .containerignore .dockerignore` or accept
the larger context. There's deliberately no second checked-in copy to drift out of
sync.

## What CI does with it

`.github/workflows/container.yml` runs on every push to `main` and every PR. Nothing
about the site's own delivery depends on it — the app ships via
[GitHub Pages](deploying-to-github-pages.md) — but without it the container path would
rot silently.

`build`, `scan` and `sca` each run **twice**, once per image, as a two-entry matrix
(`alpine`, `redhat`). Artifact names and code-scanning categories carry a `-redhat`
suffix on the second leg and are unsuffixed on the first, so the Alpine image's existing
alert history stays where it was. `publish` is not a matrix — only the Alpine image is
pushed, see below.

| Job | Tool | License | What it does |
|---|---|---|---|
| `hadolint` | [hadolint](https://github.com/hadolint/hadolint) | GPL-3.0 | Lints **both** Containerfiles: missing `USER`, unpinned bases, name-based UIDs, shell anti-patterns in `RUN`. One invocation over both files — each finding names its own file — so it stays one artifact and one code-scanning category. SARIF → **Security → Code scanning** + artifact. |
| `build` | buildah + podman (runner-preinstalled) | Apache-2.0 | Builds `--format oci` with commit-derived timestamps, then **runs** the image locked down exactly as documented above and asserts it works: `/healthz`, the real page, the SPA fallback, the expected non-root user (`101:101` or `65532:0`), and every security header `container/nginx.conf` sets (including no nginx version banner). Exports the tested image twice for the jobs below — an OCI archive for `publish` to push, a Docker-format archive for the scanners (neither reads an OCI archive tarball) — and generates a CycloneDX SBOM of it with Syft. |
| `scan` | [Trivy](https://github.com/aquasecurity/trivy) | Apache-2.0 | Scans the built image for OS/language CVEs, embedded secrets and misconfiguration. Reports everything as SARIF; fails only on **fixable** HIGH/CRITICAL, so unfixed advisories stay visible without permanently reddening the build. |
| `sca` | [OSV-Scanner](https://github.com/google/osv-scanner) | Apache-2.0 | Second, independent pass over the **image** against the OSV.dev database — different engine, different data source from Trivy. Held to the same bar as the Trivy gate (fixable, CVSS ≥ 7.0), read out of its JSON since it has no severity flag of its own. |
| `publish` | skopeo + `actions/attest*` | Apache-2.0 | **`main` only, Alpine image only**, and only if every job above passed *for both images* (`needs:` on a matrixed job waits for every leg, so a broken Red Hat build blocks the Alpine push too): pushes the exact archive that was smoke-tested to `ghcr.io/wdalmeida/yaml-config-generator-validator` (no rebuild), then attaches SLSA build provenance and the SBOM as Sigstore-signed attestations, pushed to the registry alongside the image. |

The identity assertion is two checks rather than `podman exec smoke id -u`: the Red Hat
runtime image is distroless, so there's no `id` — and no shell — inside it to exec. The
declared `UID:GID` (`101:101` / `65532:0`) is read from the image config, and `podman top
smoke user`, which psgo answers from the host, proves the live process isn't root. The
tempting single check, `podman top smoke uid`, isn't portable: podman 6 answers that
descriptor itself, while the GitHub runner's podman hands it to host `ps(1)`, which
rejects it with `unsupported option (BSD syntax)`.

Every tool is installed as a checksum-verified binary release rather than through a
wrapper action — the same reasoning that rules out `anchore/sbom-action` for Syft
(a SHA-pinned action can still fetch an unpinned binary at runtime; see
[supply chain security](supply-chain-security.md)).

The Alpine image is published as a GHCR package on the repo. Packages start private even on a public repo — make it public under **Packages → Package settings** if it should be
pullable anonymously. To stop publishing entirely, delete the `publish` job; the rest of
the workflow keeps working as a pure check.

## Caching

Two caches, chosen by measuring where the workflow actually spent its time (build 18s,
Trivy 6s, everything else 0-3s) rather than by caching whatever was cacheable:

- **Layer cache in GHCR** (`ghcr.io/<owner>/<repo>/build-cache`), via buildah's
  `--layers --cache-from/--cache-to`. Every run reads it; only a push to `main` writes it,
  so a PR can't poison what other branches build against, and a fork PR that can't reach it
  just builds every layer. The `npm ci` layer is the one that pays off — it's reused until
  `package-lock.json` changes. It lives in the registry rather than `actions/cache` because
  buildah reads and writes it in the registry's own format: no tarball to pack, upload and
  unpack, and it's shared across branches instead of being scoped to one by GitHub's cache
  isolation rules. Verified against a throwaway local registry, with the machine's own layer
  store cleared between runs so only the registry cache was available: **23.4s cold, 13.9s
  warm**, with `npm ci` reused and `COPY . .`/`npm run build` correctly rebuilt because a
  source file had changed - the resulting image contained the new content, so the reuse is
  real rather than stale.
- **Trivy's vulnerability database** (`~/.cache/trivy`), keyed by day. That's a ~110 MB
  anonymous registry pull on every cold run — the largest download here, against a rate
  limit shared with every other runner on the same IP. A cache hit doesn't mean scanning
  against a stale database: Trivy still reads the DB's own metadata and re-downloads when it
  considers it out of date. The daily key (rather than one entry per run) keeps this to one
  entry a day instead of churning the repo's 10 GB cache quota.

Deliberately not cached: the tool binaries themselves (hadolint, Trivy, Syft, OSV-Scanner).
Each is 0-2s to fetch, and every one is verified against its published checksum at install
time — restoring one from a cache would skip exactly that check to save a second.

## Why the scanners read the image, not the SBOM

Both scans take the image itself. The SBOM is a published deliverable (attested alongside
the image), not the scan input — and that's deliberate.

Measured on this repo's own image, same scanner, same database, changing only the input:

| OSV-Scanner input | Result on `nginx-unprivileged:1.29.8-alpine-slim` |
|---|---|
| The CycloneDX SBOM | 21 packages scanned, **"No issues found"** |
| The image (`scan image --archive`) | **15 vulnerabilities, 1 critical / 8 high** on `openssl 3.5.6-r0` |

The reason is how apk packages are named. An SBOM lists the *binary* subpackages actually
installed — `libcrypto3`, `libssl3` — recording `upstream=openssl` only as a purl qualifier.
OSV's Alpine advisories are keyed on the *source* package:

```text
Alpine:v3.23  libcrypto3 3.5.6-r0  ->  0 vulns    # what the SBOM lists
Alpine:v3.23  openssl    3.5.6-r0  ->  15 vulns   # what advisories are keyed on
```

Scanning the image, OSV-Scanner reads apk's own metadata and does the binary → source
mapping itself (its output even names the binary packages, the introducing layer, and
whether the package came from the base image). Fed the SBOM, it looks up `libcrypto3`, finds
nothing, and reports a clean bill of health.

This is not hypothetical here: the SBOM-based pass went green on the exact image whose
openssl CVE failed the Trivy gate in the PR that added this workflow. A second opinion that
can't see OS packages isn't defence in depth — it's a false negative with a green tick.

Two knock-on effects worth knowing:

- The SBOM is exactly as valuable as before **as an artifact** — a consumer can scan it, diff
  it between releases, or feed it to their own tooling. It just isn't a substitute for
  scanning the thing itself.
- The SBOM path also emitted ~700 lines of `Neither CPE nor PURL found for package: {...}`
  per run, one per file component Syft catalogs. Scanning the image emits none.

`supply-chain.yml`'s npm passes are unaffected — a lockfile and an npm SBOM have no
binary/source split, and one of those two passes reads the repository directly anyway.

## Accepting a CVE you can't fix, with a deadline

Almost every CVE the scanners find in this image is in the Alpine base, not in anything this
repo writes — so the fix is a base-image bump nobody here controls. Blocking every PR in the
meantime helps nobody; silently disabling the gate helps less. Both scanners therefore read a
**dated acceptance file**, and both fail the build again the moment the date passes:

| Scanner | File | Key |
| --- | --- | --- |
| Trivy | `.trivyignore.yaml` | `expired_at: YYYY-MM-DD` |
| OSV-Scanner | `osv-scanner.toml` | `ignoreUntil = YYYY-MM-DD` |

Three things about this are easy to get wrong:

- **Trivy does not auto-discover `.trivyignore.yaml`.** It auto-discovers only the plain
  `.trivyignore` format, which has no expiry at all — so an acceptance dropped in that file
  would live forever. `container.yml` passes `--ignorefile .trivyignore.yaml` explicitly, and
  that explicitness is the feature.
- **Neither scan job checks out the repo** — they scan an artifact the `build` job produced.
  Each now does a *sparse* checkout of just its own acceptance file, so the job still can't
  accidentally scan working-tree sources instead of the image.
- **OSV-Scanner's `ignoreUntil` removes the finding from its JSON**, which is what lets the
  CVSS≥7.0 gate in that job keep working unchanged. It also prints an "unused ignores" list,
  so an entry that has outlived its finding announces itself rather than lingering.

**Both files ship empty, and should stay that way.** An entry belongs in them only when the fix
is genuinely outside this repo's control; anything a dependency bump can fix gets bumped
instead (see the `overrides` block in `package.json` for that pattern). Each file carries the
format as a comment so an entry can be added without looking it up.

The same base-image problem does not look the same to both tools, which is why there are two
files rather than one. Trivy tends to report a base-image issue as a single CVE where OSV
splits Alpine's advisories for the same package into several `ALPINE-CVE-*` ids — during the
openssl episode that prompted this, one CVE in Trivy was nine ids in OSV. Adding an id to one
file does not cover the other.

`container.yml` also runs **weekly on a schedule**, not only on push and PR. An expiry date is
only meaningful if something runs to notice it; without the cron, an acceptance could outlive
its deadline unnoticed on a quiet week. The weekly run also catches a newly published CVE
landing against an image whose own inputs never changed.

When the base image is bumped, delete the entries rather than extending the date. An
acceptance that gets renewed twice is a decision nobody is really making.

## What the scanners can and can't see

**Neither vulnerability scanner in this pipeline can read the Red Hat image today.** This
is the reason it is built, smoke-tested and SBOM'd on every run but not published.

Measured on the image this repo builds, with the same tool versions CI installs:

| Tool | Result on `Containerfile.redhat`'s image |
|---|---|
| Trivy 0.74.0 | OS family `none`, **0 packages**, 0 findings, exit 0 |
| OSV-Scanner 2.5.1 | `No package sources found`, no report written at all |
| Syft 1.51.0 | **45 rpm packages** catalogued — the SBOM is complete |
| Grype (not in this pipeline) | distro detected as `hummingbird`, **17 matches** |

The cause is one line in the image:

```text
ID="hummingbird"
ID_LIKE="fedora rhel"
```

Nothing is hidden — the rpm database is right there at
`/usr/lib/sysimage/rpm/rpmdb.sqlite`, which is why Syft reads all 45 packages without
complaint. Trivy and OSV-Scanner map `ID` against a fixed list of known distributions,
`hummingbird` isn't on it, and neither falls back to `ID_LIKE`. Grype does fall back, and
its database already carries Hummingbird advisories (it names fixes with `.hum1` release
tags), so this is a scanner gap and a matter of time, not an unscannable image.

**Don't "fix" it with `--distro`.** `trivy image --distro redhat/10` makes Trivy read the
rpm database and report 45 packages and zero vulnerabilities, which looks like a working
scan and isn't one: these are Hummingbird's own builds (`glibc-2.43-8.5.hum1`,
`pcre2-10.47-1.2.hum1`), and comparing `.hum1` versions against Red Hat Enterprise Linux
advisory NVRs matches nothing by construction. That's a worse outcome than scanning
nothing, because it is indistinguishable from a clean bill of health.

So CI says it out loud instead:

- the `scan` job runs a coverage step that prints the OS family and package count, and
  raises a workflow **warning** when either comes back empty;
- the `sca` job detects the empty result, skips its SARIF upload (an empty SARIF would
  post an authoritative-looking zero-alert result to code scanning for an image nobody
  examined) and skips its gate, warning both times;
- `publish` pushes the Alpine image only.

The dated acceptance files above are part of the same picture: they only matter for a
scanner that can see an image in the first place, so today they are an Alpine-image
mechanism regardless of which leg reads them.

For the record, at the time of writing Grype reports 2 fixable HIGH CVEs in the Red Hat
image (`CVE-2026-86145`, `CVE-2026-89161`, both `pcre2 10.47-1.2.hum1`, fixed in
`10.48-0.1.hum1`) — Hummingbird's own rebuild cadence closes those, and a Renovate digest
bump picks it up. That number is exactly the kind of thing this repo's gates are supposed
to surface automatically, and right now, for this image, they can't.

**What closes this**: Trivy or OSV-Scanner learning the `hummingbird` distro ID (or
falling back to `ID_LIKE`), or adding Grype as a third scanner for this variant. The
first costs nothing here but a version bump; the second is a new tool in the supply chain
and its own decision. When either lands, publishing the Red Hat image is the matrix
change described in the `publish` job's comment.

## Pulling and verifying a published image

```sh
podman pull ghcr.io/wdalmeida/yaml-config-generator-validator:latest

# Provenance: who built this digest, from which commit and workflow
gh attestation verify \
  oci://ghcr.io/wdalmeida/yaml-config-generator-validator:latest \
  --repo wdalmeida/yaml-config-generator-validator
```

Only the Alpine image is published; build the Red Hat one locally with
`buildah bud -f Containerfile.redhat`.

`gh attestation verify` checks the Sigstore signature and the SLSA provenance predicate
against this repository — an image someone else rebuilt and pushed under the same tag
fails that check.

## Deliberately not done

- **Multi-arch (`linux/arm64`) images.** Would need `buildah manifest` plus QEMU
  emulation for the Node build — minutes of CI time for a use case nobody has asked for
  yet. Add it when someone actually needs an arm64 image. (Every base image all four
  stages pin is itself multi-arch — the digests in both Containerfiles are index
  digests, so a local `podman build` on an arm64 machine already works. It's only CI
  that publishes amd64 alone.)
- **A FIPS build.** `hi/nginx` and `hi/nodejs` both publish `-fips` tags. That's a
  one-line change to `Containerfile.redhat` if someone needs it, but it's a compliance
  claim nobody here has made yet, and it would be a third image to build and scan.
- **A `HEALTHCHECK` instruction** — see above; `/healthz` covers it portably.
- **Signing with cosign directly.** The GitHub attestations are Sigstore-backed and
  registry-pushed already; a second signing path would be one more key story for no
  extra guarantee here.
