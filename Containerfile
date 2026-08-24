# Builds the static site, then serves it from a minimal, non-root nginx.
#
# Only plain OCI-compatible instructions are used - no BuildKit-only `# syntax=`
# directive, no `RUN --mount` cache mounts - so `buildah bud`, `podman build` and
# `docker build` all produce the same image. See docs/container.md.
#
# Base images are pinned by digest (the tag is kept alongside it only so the pin is
# readable, and so Renovate can bump both together), matching how every `uses:` in
# .github/workflows is pinned - a tag is mutable, a digest is not.

FROM docker.io/library/node:24.16.0-alpine3.22@sha256:191c9f0080fcbbc6547a85dc0ff7988072214a355aabdc1d2ec55a7dae5eea8a AS build

# WORKDIR alone creates /app owned by root, and buildah - unlike podman/docker's builder -
# doesn't hand it to the USER declared further down, so `npm ci` fails with EACCES on
# /app/node_modules. Creating and chowning it explicitly works the same way everywhere.
RUN mkdir -p /app && chown 1000:1000 /app
WORKDIR /app

# Manifest + lockfile first, so the install layer is only invalidated by a dependency
# change, not by every source edit.
COPY --chown=1000:1000 package.json package-lock.json ./

# 1000:1000 is the `node` user the official image ships; numeric so the host can resolve it
# without a name lookup (hadolint DL3066) and so it survives a base image rename.
USER 1000:1000

# --ignore-scripts: no dependency lifecycle script runs at install time, so a
# compromised package cannot execute code during the build. Nothing here needs one -
# esbuild/rollup ship prebuilt per-platform binaries as optional dependencies.
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY --chown=1000:1000 . .

RUN npm run build


FROM docker.io/nginxinc/nginx-unprivileged:1.31.3-alpine-slim@sha256:d61d7ef52430df468e74ed6ee6e914429b80e20ba988e3176278a73165f876cf AS runtime

# Supplied by the build (see docs/container.md); left empty when building by hand.
ARG IMAGE_CREATED=""
ARG IMAGE_REVISION=""
ARG IMAGE_VERSION=""

LABEL org.opencontainers.image.title="yaml-config-generator-validator" \
      org.opencontainers.image.description="Static site for filling out and validating the YAML config files our software requires" \
      org.opencontainers.image.source="https://github.com/wdalmeida/yaml-config-generator-validator" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.created="${IMAGE_CREATED}" \
      org.opencontainers.image.revision="${IMAGE_REVISION}" \
      org.opencontainers.image.version="${IMAGE_VERSION}"

COPY container/nginx.conf /etc/nginx/conf.d/default.conf

# Deliberately left root-owned: nginx reads these as UID 101 and never needs to write
# them, so the running container cannot rewrite its own web root.
COPY --from=build /app/dist /usr/share/nginx/html

# Already the base image's default; restated numerically so it survives a base image
# change and so Kubernetes' runAsNonRoot check can verify it without resolving a name.
USER 101:101

EXPOSE 8080

# nginx treats SIGQUIT as "finish in-flight requests, then exit"; SIGTERM kills them.
STOPSIGNAL SIGQUIT

# No HEALTHCHECK: it is a Docker-format extension with no field in the OCI image spec,
# and buildah drops it unless the image is built with `--format docker`. Probe the
# /healthz endpoint from the orchestrator instead (see docs/container.md).

CMD ["nginx", "-g", "daemon off;"]
