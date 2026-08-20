# yaml-config-generator-validator

A small static site that helps users fill out and validate the YAML config file required by our software, instead of hand-editing it and making mistakes.

- **Generate**: fill out a form (tenant, product, proxy entries, GitHub topics) and get a valid YAML file to copy or push straight to a GitHub repo via a prefilled "create file" link.
- **Validate**: paste an existing YAML file and check it against the same schema.

See `CLAUDE.md` for architecture details.

## Develop

```sh
npm install
npm run dev
```
