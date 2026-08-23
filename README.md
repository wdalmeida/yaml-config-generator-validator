# yaml-config-generator-validator

A small static site that helps users fill out and validate the YAML config files required by our software, instead of hand-editing them and making mistakes. Handles multiple file types in parallel — Tenant Config, CI, CD, Env, Protection — switchable via the pill strip, each with its own schema and its own saved draft.

Each config type is one two-column screen: the left column has target file location and that
type's own fields, scrolling normally as the form grows; the right column is one live, editable
YAML field, pinned in view as you scroll the form so it's never out of sight — fill in the form
and watch it update, or fetch/paste/edit YAML directly and watch the form sync back once it's
valid. Push it as a new file via a prefilled "create file" link, or update an existing one
(copies the YAML for you, since GitHub can't prefill an edit).

CI/CD/Env/Protection schemas are placeholders pending real field specs — see `CLAUDE.md`.

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
- [Deploying to GitHub Pages](docs/deploying-to-github-pages.md)
- [Supply chain security](docs/supply-chain-security.md) — SBOM, attestations, SCA/SAST scanning
- [Releasing](docs/releasing.md) — Conventional Commits, automated versioning/changelog/tags
