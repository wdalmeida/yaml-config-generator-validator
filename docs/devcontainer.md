# Development container

`.devcontainer/` builds an image with Node 24 — the version every workflow runs on — every
tool `.github/workflows` installs, `just` to drive them, and two agent CLIs (Claude Code and
opencode). Open the repo in it and `just ci` works on the first try, with no per-machine
install of nine security scanners.

It is a development convenience only. Nothing ships from it: the site deploys from
[GitHub Pages](deploying-to-github-pages.md), and the [container image](container.md) that
serves it is a separate, much smaller build.

## Opening it

- **VS Code** — install the Dev Containers extension, then *Reopen in Container*.
- **CLI** — `npx @devcontainers/cli up --workspace-folder .`
- **Anything else** — the image is a plain Dockerfile: `docker build -f .devcontainer/Dockerfile .`

The first build downloads the base image and roughly 300 MB of tools, so give it a few
minutes. `postCreateCommand` then runs `npm ci` and prints `just doctor`.

## What's in it

| | |
|---|---|
| Node 24, npm | matches `node-version: 24` in the workflows |
| Go | matches `go-version:` in the workflows — `ci.yml`'s `go` job and the `tools/` module every check now runs through |
| just, jq, python3, uv, gh | what the recipes themselves lean on |
| actionlint, gitleaks, zizmor, plumber | `ci.yml`'s workflow/secret scanners |
| syft, osv-scanner, semgrep | `supply-chain.yml`'s SBOM and SCA/SAST passes |
| hadolint, trivy | `container.yml`'s image linting and scanning |
| helm, kubeconform, helm-unittest | `ci.yml`'s `helm` job — chart unit tests, rendering and schema checks |
| podman, buildah, skopeo | building and pushing the image `container.yml` builds |
| Claude Code, opencode | agent CLIs |

Homebrew is not installed and isn't needed: `just install` falls back to the pinned,
checksum-verified downloads when it finds no `brew`, which is exactly how this image got its
tools in the first place.

## How the versions stay right

The image does **not** carry its own list of tool versions. It copies in `justfile` and
`.github/workflows` and runs `just install-pinned <tool>` for each one, which reads the
version out of the workflow that pins it — the same string Renovate's custom managers bump
weekly. A rebuilt image therefore runs, by construction, the versions CI runs.

The Go toolchain follows the same rule by a slightly different route. It isn't a
`just install-pinned` tool — it's a toolchain rather than a release binary, and its checksums
live in its release JSON rather than in a sibling `.sha256` — so the Dockerfile installs it
directly, reading the version with `just --evaluate go_version`, which is the same grep of
`ci.yml` the justfile already does. Still no second list, still checksum-verified.

Three tools are the exception, because they have to exist before `just` can install anything:
`just` itself, `uv` and `gh`. Those are pinned as `ARG`s in `.devcontainer/Dockerfile`,
annotated with `# renovate:` comments so `renovate.json`'s `devcontainer-tools` manager keeps
them current.

**kube-linter is the one tool from `ci.yml` this image cannot bake in.** Its release publishes
no checksums file, so `just install-pinned kube-linter` reads the asset's sha256 from GitHub's
release API — which needs an authenticated `gh` session the image build doesn't have. Run

```sh
just install-pinned kube-linter
```

once inside the running container, where you are logged in. Until then `just helm` gets through
the unit tests, the lint and the render and then fails at its kube-linter step. (This is the
same reason `just install-pinned plumber`'s optional `gh attestation verify` step is deferred
to runtime.)

Claude Code and opencode are deliberately unpinned. They're interactive tools rather than
gates, they release several times a week, and Claude Code updates itself in place at runtime —
a pin would be stale within days.

When a Renovate bump lands after your image was built, `just doctor` reports the drift and
`just install-pinned <tool>` closes it in seconds, into `.ci-tools/bin` inside the workspace.
Rebuilding the container is the tidier fix, not the urgent one.

## Running containers inside the container

`just container` builds and smoke-tests the app image with podman, nested inside this one. That
needs one thing from the host, and `devcontainer.json` asks for it: **`--privileged`**.

Without it, setting up the nested user namespace is refused —
`newuidmap: write to uid_map failed: Operation not permitted`. Extra capabilities are not a
substitute: granting `cap_setuid`/`cap_setgid` explicitly was tested and still fails. The
official docker-in-docker devcontainer feature requires the same flag for the same reason.

What it costs depends on your host. On a **rootless podman** host, a privileged container is
still confined to your own user namespace — it can do nothing you couldn't do yourself. Under
**Docker's root daemon** it is a real grant to the container. If you'd rather not give it,
delete the line from `runArgs`: the container still starts and everything except the
`just container` group works, and those recipes run fine on the host.

Nothing else is needed — `--privileged` already covers `/dev/fuse` (the fuse-overlayfs storage
driver, since a nested unprivileged container can't use the kernel's own overlayfs),
`/dev/net/tun` (pasta's port forwarding, which `just image-smoke` needs to publish port 8080 and
curl it) and the seccomp profile. Podman's image store is on a named volume, so bases aren't
re-pulled on every rebuild.

Both host models were verified against this repo's real `just image-build` and
`just image-smoke`: once on a rootless macOS `podman machine`, and once against rootful podman
inside that same VM, which runs containers outside any user namespace exactly as dockerd does.

## Credentials and caches

The mounts in `devcontainer.json` are **named volumes, not bind mounts of your host's
dotfiles** — the container gets its own credentials rather than reaching into yours. Log in
once inside (`gh auth login`, `claude`, `opencode auth login`) and it survives rebuilds. Swap
a line for a bind mount if you would rather share the host session:

```jsonc
"source=${localEnv:HOME}/.claude,target=/home/node/.claude,type=bind"
```

`CLAUDE_CONFIG_DIR` is set to `/home/node/.claude` so Claude Code keeps its config inside that
volume instead of in a `~/.claude.json` a rebuild would discard.

Trivy's ~110 MB vulnerability database gets a volume too — `container.yml` caches it per day
for the same reason: it's re-downloaded from a rate-limited registry whenever it's missing.

## What isn't replicated

The same three things `just` can't replicate anywhere: uploading SARIF to GitHub code
scanning, Sigstore attestation, and the GHCR publish. All three need a runner's OIDC identity.
See the justfile's own header and [supply chain security](supply-chain-security.md).
