# yaml-config-generator-validator

A small static site that helps users through onboarding: an **Onboarding** checklist of the
steps to follow, and then the YAML config files our software requires, filled out and
validated here instead of hand-edited and got wrong. Handles multiple file types in parallel —
Tenant Config, CI, CD, Env, Protection — switchable via the pill strip, each with its own
schema and its own saved draft.

Each config type is one two-column screen: the left column has the target file location
(owner/repo/branch — prefilled from the URL when the tool is served from that repo's own
GitHub Pages site — plus the fixed filename, which isn't editable) and that type's own
fields, scrolling normally as the form grows; the right column is one live, editable
YAML field, pinned in view as you scroll the form so it's never out of sight — fill in the form
and watch it update, or fetch/paste/edit YAML directly and watch the form sync back once it's
valid. Push it as a new file via a prefilled "create file" link, or update an existing one
(copies the YAML for you, since GitHub can't prefill an edit).

The **Onboarding** pill is the front door and looks nothing like the rest: one centred column
of imperative steps you tick off (ticked ones strike through and go green), each carrying
whatever it takes to do it — docs, a website, a Jira ticket, a command to copy, or a jump
straight to the pill that generates its output. The steps live in a JSON file, so the process
is edited without touching the app. Type your tenant and product once there and one button
seeds them into every pill that needs them.

The **Kubernetes** pill is one of those outputs: a namespace, two service accounts, a Role, a
RoleBinding and a token Secret each, all named from your tenant and product, rendered as one
stream to copy and `kubectl apply`. No file, no schema — see
[Kubernetes resources](docs/kubernetes-resources.md).

CI/CD/Env/Protection schemas, the shipped checklist steps, and the Kubernetes RBAC are
placeholders pending real specs — see `CLAUDE.md`.

See `CLAUDE.md` for architecture details.

## Develop

```sh
npm install
npm run dev
npm test              # or: npm run test:coverage
```

## License

[MIT](LICENSE)

## Docs

- [Adding or updating a config schema](docs/adding-a-schema.md)
- [Adding or updating onboarding steps](docs/adding-onboarding-steps.md) — the checklist file format and its action types
- [Kubernetes resources](docs/kubernetes-resources.md) — what the Kubernetes pill renders, and what in it is still a placeholder
- [Deploying to GitHub Pages](docs/deploying-to-github-pages.md)
- [Running as a container](docs/container.md) — Buildah/OCI build of the static site, and the CI that builds, scans and publishes it
- [Supply chain security](docs/supply-chain-security.md) — SBOM, attestations, SCA/SAST scanning
- [Releasing](docs/releasing.md) — Conventional Commits, automated versioning/changelog/tags
