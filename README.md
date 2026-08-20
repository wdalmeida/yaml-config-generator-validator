# yaml-config-generator-validator

A small static site that helps users fill out and validate the YAML config files required by our software, instead of hand-editing them and making mistakes. Handles multiple file types in parallel — Tenant Config, CI, CD, Env, Protection — switchable via the pill strip, each with its own schema and its own saved draft.

Each config type is one two-column screen: the left column (fetch from GitHub or paste YAML,
then Validate or Load into form) is the same across every type; the right column has that
type's own fields, the generated YAML, and Push to GitHub — copy it, push it as a new file via
a prefilled "create file" link, or update an existing one (copies the YAML for you, since
GitHub can't prefill an edit).

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
