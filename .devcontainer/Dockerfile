# Development container for this repo: Node 24 (the version every workflow runs on), every
# tool .github/workflows installs, and the two agent CLIs (Claude Code, opencode).
#
# The CI tools are deliberately NOT pinned in this file. The build copies in `justfile` and
# `.github/workflows` and runs `just install-pinned`, which reads each version out of the
# workflow that pins it - so this image tracks Renovate's weekly "workflow tool versions"
# bumps with no second list to maintain, and a freshly built image runs, by construction,
# exactly what CI runs. Only the three bootstrap tools that have to exist before `just` can
# do anything (just, uv, gh) carry a pin of their own, kept current by renovate.json's
# devcontainer-tools custom manager.
#
# See docs/devcontainer.md.

FROM mcr.microsoft.com/devcontainers/typescript-node:24-trixie@sha256:fb4652b1a9bca94d31eaa4d8446176e96350a7644b4633675612ce6b2c1e2b1f

# Docker honours this; podman building in OCI format ignores it ("SHELL is not supported for
# OCI image format"), so no RUN below may *depend* on `set -e` - each is an && chain, and the
# one loop guards itself with `|| exit 1`.
SHELL ["/bin/bash", "-euo", "pipefail", "-c"]

# `node` and `root` rather than numeric ids: those are the names the base image creates and
# that devcontainer.json's remoteUser refers to.
# hadolint ignore=DL3066
USER root

# podman drives every `just image-*` recipe; buildah and skopeo are what container.yml itself
# uses on the runner, so they're here too rather than leaving the image a near-miss.
# fuse-overlayfs/uidmap/passt/slirp4netns are what rootless podman needs to run *inside* this
# container - the host side of that is in docs/devcontainer.md.
# apt versions aren't pinned: the base image is digest-pinned, which fixes the package set to
# that snapshot of Debian trixie far more usefully than a version list needing a hand-bump on
# every point release.
# hadolint ignore=DL3008
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      podman buildah skopeo \
      fuse-overlayfs uidmap passt slirp4netns \
      python3 python3-venv jq unzip \
 && rm -rf /var/lib/apt/lists/*

# --- bootstrap: the three tools that have to exist before `just` can install the rest -------
# Each is fetched from its own GitHub release and verified against that release's published
# checksum file, the same way every workflow (and `just install-pinned`) installs a binary.

# renovate: datasource=github-releases depName=casey/just
ARG JUST_VERSION=1.58.0
# The cd below is inside a subshell, so `sha256sum -c` can resolve the filename its checksum
# line names; WORKDIR is not an equivalent (same for the uv and gh installs).
# hadolint ignore=DL3003
RUN tmp="$(mktemp -d)" \
 && case "$(dpkg --print-architecture)" in \
      amd64) target=x86_64-unknown-linux-musl ;; \
      arm64) target=aarch64-unknown-linux-musl ;; \
      *) echo "unsupported architecture: $(dpkg --print-architecture)" >&2; exit 1 ;; \
    esac \
 && asset="just-${JUST_VERSION}-${target}.tar.gz" \
 && base="https://github.com/casey/just/releases/download/${JUST_VERSION}" \
 && curl -fsSL -o "${tmp}/${asset}" "${base}/${asset}" \
 && curl -fsSL -o "${tmp}/SHA256SUMS" "${base}/SHA256SUMS" \
 && ( cd "$tmp" && grep " ${asset}\$" SHA256SUMS | sha256sum -c - ) \
 && tar -xzf "${tmp}/${asset}" -C /usr/local/bin just \
 && rm -rf "$tmp"

# renovate: datasource=github-releases depName=astral-sh/uv
ARG UV_VERSION=0.12.6
# hadolint ignore=DL3003
RUN tmp="$(mktemp -d)" \
 && case "$(dpkg --print-architecture)" in \
      amd64) target=x86_64-unknown-linux-gnu ;; \
      arm64) target=aarch64-unknown-linux-gnu ;; \
      *) echo "unsupported architecture: $(dpkg --print-architecture)" >&2; exit 1 ;; \
    esac \
 && asset="uv-${target}.tar.gz" \
 && base="https://github.com/astral-sh/uv/releases/download/${UV_VERSION}" \
 && curl -fsSL -o "${tmp}/${asset}" "${base}/${asset}" \
 && curl -fsSL -o "${tmp}/${asset}.sha256" "${base}/${asset}.sha256" \
 && ( cd "$tmp" && sha256sum -c "${asset}.sha256" ) \
 && tar -xzf "${tmp}/${asset}" -C "$tmp" \
 && install -m 0755 "${tmp}/uv-${target}/uv" "${tmp}/uv-${target}/uvx" /usr/local/bin/ \
 && rm -rf "$tmp"

# --- the CI toolchain, at the versions the workflows pin ------------------------------------
# One `just install-pinned` per tool, with tools_dir pointed at /usr/local so they land on the
# system PATH instead of in a workspace directory that a bind mount would shadow at runtime.
COPY justfile /tmp/ci-bootstrap/justfile
COPY .github/workflows /tmp/ci-bootstrap/.github/workflows
# hadolint ignore=DL3003
RUN cd /tmp/ci-bootstrap \
 && for tool in actionlint gitleaks zizmor plumber syft osv-scanner semgrep hadolint trivy \
                helm kubeconform helm-unittest; do \
      just tools_dir=/usr/local install-pinned "$tool" || exit 1; \
    done \
 && rm -rf /root/.cache

# The Go toolchain, for the tools/ module - ci.yml's `go` job and the severity gates
# container.yml runs. Deliberately NOT a pinned ARG like just/uv/gh above: the version is read
# out of the copied workflows through `just --evaluate go_version`, the same grep the justfile
# already does, so this image still carries no tool-version list of its own and a Renovate bump
# to the workflows lands here on the next rebuild for free.
#
# Go is not a `just install-pinned` tool because it is a toolchain rather than a release binary,
# and its checksums live in its release JSON rather than a sibling .sha256 - the same shape as
# kube-linter's, and the same trust root as the download itself.
# hadolint ignore=DL3003
RUN cd /tmp/ci-bootstrap \
 && version="$(just --evaluate go_version)" \
 && arch="$(dpkg --print-architecture)" \
 && asset="go${version}.linux-${arch}.tar.gz" \
 && want="$(curl -fsSL 'https://go.dev/dl/?mode=json&include=all' \
      | jq -r --arg a "$asset" '.[].files[] | select(.filename == $a) | .sha256')" \
 && test -n "$want" \
 && curl -fsSL -o "/tmp/${asset}" "https://go.dev/dl/${asset}" \
 && echo "${want}  /tmp/${asset}" | sha256sum -c - \
 && tar -C /usr/local -xzf "/tmp/${asset}" \
 && ln -s /usr/local/go/bin/go /usr/local/bin/go \
 && ln -s /usr/local/go/bin/gofmt /usr/local/bin/gofmt \
 && rm -rf "/tmp/${asset}" /tmp/ci-bootstrap

# kube-linter is the one tool from ci.yml's helm job this image cannot bake in. Its release
# publishes no checksums file, so `just install-pinned kube-linter` reads the asset's sha256
# from GitHub's release API, and that needs an authenticated gh session the build doesn't
# have (the same reason gh itself is installed below rather than above). Run
# `just install-pinned kube-linter` once inside the running container, where you are logged
# in; until then `just helm` fails at its kube-linter step having already run the unit tests,
# the lint and the render.

# gh is installed *after* that loop on purpose: `just install-pinned plumber` additionally
# verifies plumber's SLSA build provenance with `gh attestation verify` when gh is present,
# and that call needs an authenticated GitHub session this build doesn't have. Checksum
# verification still happens; the attestation check is what a later `just install-pinned
# plumber` inside the running container (where you are logged in) adds on top.
# renovate: datasource=github-releases depName=cli/cli
ARG GH_VERSION=2.98.0
# hadolint ignore=DL3003
RUN tmp="$(mktemp -d)" \
 && arch="$(dpkg --print-architecture)" \
 && asset="gh_${GH_VERSION}_linux_${arch}.tar.gz" \
 && base="https://github.com/cli/cli/releases/download/v${GH_VERSION}" \
 && curl -fsSL -o "${tmp}/${asset}" "${base}/${asset}" \
 && curl -fsSL -o "${tmp}/checksums.txt" "${base}/gh_${GH_VERSION}_checksums.txt" \
 && ( cd "$tmp" && grep " ${asset}\$" checksums.txt | sha256sum -c - ) \
 && tar -xzf "${tmp}/${asset}" -C "$tmp" \
 && install -m 0755 "${tmp}/gh_${GH_VERSION}_linux_${arch}/bin/gh" /usr/local/bin/gh \
 && rm -rf "$tmp"

# --- rootless podman, nested ----------------------------------------------------------------
# A subuid/subgid range for the node user (the base image ships none, and rootless podman
# refuses to start without one) and the fuse-overlayfs storage driver, since the kernel's own
# overlayfs isn't usable from inside an unprivileged container. /run/user/1000 is created by
# hand because nothing here runs systemd-logind to create it, and rootless podman needs a
# runtime directory (devcontainer.json points XDG_RUNTIME_DIR at it). The mkdir at the end creates
# every path a named volume gets mounted over: Docker creates a missing mount point as root,
# which the node user then can't write to.
RUN echo 'node:100000:65536' > /etc/subuid \
 && echo 'node:100000:65536' > /etc/subgid \
 && install -d -o node -g node -m 0700 /run/user/1000 \
 && mkdir -p /home/node/.config/containers \
 && printf '%s\n' \
      '[storage]' \
      'driver = "overlay"' \
      'runroot = "/run/user/1000/containers"' \
      'graphroot = "/home/node/.local/share/containers/storage"' \
      '' \
      '[storage.options.overlay]' \
      'mount_program = "/usr/bin/fuse-overlayfs"' \
      > /home/node/.config/containers/storage.conf \
 && mkdir -p /home/node/.local/share/containers \
             /home/node/.local/share/opencode \
             /home/node/.config/opencode \
             /home/node/.config/gh \
             /home/node/.cache/trivy \
             /home/node/.claude \
 && chown -R node:node /home/node

# hadolint ignore=DL3066
USER node

# Claude Code and opencode are deliberately unpinned: they're interactive tools, not part of
# any gate, they ship several releases a week, and Claude Code updates itself in place at
# runtime - so a pin here would be stale within days and a lie within hours. They install into
# the base image's node-owned global prefix, which is what lets that self-update work.
# hadolint ignore=DL3016
RUN npm install -g @anthropic-ai/claude-code opencode-ai \
 && npm cache clean --force
