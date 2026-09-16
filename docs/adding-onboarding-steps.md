# Adding or Updating Onboarding Steps

The **Onboarding** pill is a checklist a user works top to bottom. Its steps are data, not
code: one `*.onboarding.json` file per checklist in `src/onboarding/`, discovered
automatically. Dropping a file in is the entire integration — no other file needs to change.

The checklist itself produces no file. A step's *output* is either one of the config files
(each on its own pill) or the Kubernetes resources (also its own pill), so the page is nothing
but the steps: progress is saved in the browser and never leaves it.

If you're looking for the *config file* schemas instead (Tenant Config, CI, CD, Env,
Protection), see [Adding or updating a config schema](adding-a-schema.md).

## Is there a file format?

Yes. Each file is validated three ways, so a mistake surfaces early rather than as a broken
page:

- **Your editor**, via the `$schema` key pointing at `onboarding.meta.schema.json` — you get
  autocomplete and inline errors while typing.
- **CI**, via `npm run lint:schemas`, which validates every `*.onboarding.json` against that
  same meta-schema and checks referential integrity (see below).
- **At runtime**, via a Zod schema in `src/onboarding/types.ts`, which is also what derives
  the TypeScript types — so there's one description of the shape, not two.

## A minimal file

```json
{
  "$schema": "./onboarding.meta.schema.json",
  "title": "Onboarding",
  "x-onboarding-id": "onboarding",
  "x-console-label": "OpenShift console",
  "steps": [
    {
      "id": "raise-request",
      "title": "Raise the onboarding request ticket",
      "actions": [{ "type": "jira", "key": "PLAT-1001" }]
    }
  ]
}
```

## Top-level keys

| Key | Required | Meaning |
| --- | --- | --- |
| `title` | yes | The pill label. |
| `x-onboarding-id` | yes | Stable id. Also the `localStorage` key suffix — **changing it orphans every user's saved progress**, and it must not collide with any pill's id. |
| `intro` | no | One paragraph above the step list. |
| `x-console-label` | no | What your org calls its web console, e.g. `OpenShift console`. Labels the console **link** only — the switch itself stays generic. Defaults to `Console`. |
| `steps` | yes | At least one step, in the order the user should work through them. |

## Step keys

| Key | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Stable, lowercase-hyphenated. This is the value written into the checklist YAML, so **renaming it orphans that step's saved progress**. |
| `title` | yes | Write it in the **imperative mood** — "Commit config.yaml", not "Committing config.yaml" or "You should commit config.yaml". A step is an instruction. |
| `detail` | no | One sentence of context under the title. |
| `optional` | no | An optional step doesn't have to be ticked for the pill's dot to go green. |
| `actions` | no | Path-independent references — see **Actions** below. Defaults to none. |
| `cli` | no | How to do the step from a terminal — see **Two routes** below. |
| `ui` | no | How to do it in the web console. |

## Actions

A step's own `actions` are the **path-independent** references — documentation, tickets, a jump
to another pill. They show whichever route the reader picked. **Jira is one option among
several, not a required field.**

> A `command` action must **not** go here. Commands are the CLI route by definition, and one in
> this list would be shown to a reader who explicitly asked for the UI route — the single thing
> the switch exists to prevent. Put it in `cli.actions`. Both `npm run lint:schemas` and the Zod
> schema reject it.

| `type` | Keys | Renders as |
| --- | --- | --- |
| `docs` | `url`, `label?` (default `Docs`) | An external link. |
| `link` | `url`, `label` | An external link, for anything that isn't documentation. |
| `jira` | `key`, `label?` | A link built from the user's own Jira base URL — see below. |
| `command` | `command`, `label?` | The command inline, with a Copy button. |
| `config` | `configId`, `label?` | A button that switches to the pill that step is about — a config type's `x-config-id`, or `kubernetes`. |

```json
"actions": [
  { "type": "docs", "url": "https://example.com/docs/onboarding/tenant-config" },
  { "type": "link", "label": "Access portal", "url": "https://example.com/portal" },
  { "type": "jira", "key": "PLAT-1003" },
  { "type": "command", "label": "Install the toolchain", "command": "just install" },
  { "type": "config", "configId": "tenant-config" }
]
```

Rules enforced for you:

- A `url` must be `http:` or `https:`. These values reach an `href`, so this is a security
  boundary, not style — the same rule blocks a `javascript:` Jira base URL at runtime.
- A `jira` `key` must look like a real ticket key (`^[A-Z][A-Z0-9]+-\d+$`).
- A `config` `configId` must name an existing pill. `npm run lint:schemas` fails on a typo; at
  runtime an unresolvable one simply renders nothing, so deleting a schema file can never
  white-screen the app.

## Two routes: `cli` and `ui`

Most steps can be done either from a terminal or by clicking through some interface. A reader
picks one with the **Command line / UI** switch above the list, and sees only that one — so each
route gets its own block, with an ordered sub-list of what to actually do.

The switch says "UI", not the name of any particular console, because a step's UI route is
frequently something else entirely: a Jira form, an access portal, GitHub's web editor. The
`x-console-label` name appears on the console *link*, where it really is one specific console.

```json
{
  "id": "create-namespace",
  "title": "Create your namespace and its RBAC",
  "actions": [
    { "type": "docs", "url": "https://example.com/docs/onboarding/namespace" },
    { "type": "jira", "key": "PLAT-1006" }
  ],
  "cli": {
    "instructions": [
      "Open the Kubernetes pill, fill in your tenant and product, and hit Copy all.",
      "Paste the manifests into the command below and press Ctrl-D."
    ],
    "actions": [{ "type": "command", "command": "kubectl apply -f -" }]
  },
  "ui": {
    "console": "/k8s/cluster/projects",
    "instructions": [
      "Switch to the Administrator perspective.",
      "Go to Home -> Projects and click Create Project.",
      "Name it <tenant>-<product>, matching the Kubernetes pill exactly."
    ]
  }
}
```

| Key | In | Meaning |
| --- | --- | --- |
| `instructions` | both | Ordered sub-list, rendered as a numbered `<ol>`. Write one clear action per entry. |
| `actions` | both | Route-specific links or commands, shown under the instructions. |
| `console` | `ui` only | A **path**, not a full URL — appended to the console base URL the reader types once, so one checklist works against any cluster. |

A step may have one route, both, or neither.

**The switch only hides a route when there is a choice to make.** A step documenting just one
way shows that one way whichever route is selected, tagged `CLI only` or `UI only` so the
reader understands why they're looking at commands while the switch says UI. Hiding it would
leave the step looking like it needs nothing done to it.

So don't invent a second route to fill a gap — some steps genuinely have one. Requesting repo
access is a portal-and-approval flow with no terminal equivalent; bootstrapping a checkout is
commands and nothing else. A step with neither block (a "go ask someone" step) just shows its
title and its shared actions, which is fine too.

## The Jira base URL

Ticket keys are stored in the checklist file, but the **host is not** — each user types their
own Jira base URL once, and it's persisted in their browser under `jira-base-url`. Until they
do, a step's ticket key renders as plain text rather than a link: the default placeholder
(`https://your-org.atlassian.net`) is a domain nobody here controls, and sending a user there
would be worse than sending them nowhere.

The base URL is deliberately **not** part of the checklist YAML — it's a per-user setting, not
part of a tenant's onboarding record.

## Where progress lives

Ticks are saved to `localStorage` under `onboarding:<x-onboarding-id>`, as the list of ticked
step ids. That list is the whole state — there is no checklist file to commit, fetch or push.

Consequences worth knowing when you edit a file:

- A step you **add** is simply unticked for everyone. A step you **remove** stops rendering.
  Both are correct with no migration.
- Renaming a step's `id` orphans that step's saved progress, which is why the id is described
  as stable above. An id in storage matching no step is **kept**, not discarded, so a rename
  and a revert doesn't destroy someone's ticks.
- Progress is per-browser. It does not sync between machines and is not shared with anyone.

## The console base URL

Same shape as the Jira one, and the same reasoning: the console **host** is per-user (a
different cluster per reader), so it's typed once and persisted under `console-base-url`, while
each step carries only a path. Until a base URL is set, a step's `console` path renders as plain
text rather than a broken link, and a non-`http(s)` value never becomes a link at all.

Console links open in a **new tab**. There is no web API for split-screen — a page cannot put
the browser into split view, that's a browser/OS feature the reader triggers themselves — so
the UI route shows a one-line hint saying so rather than pretending otherwise.

Note the console is only *one* kind of UI route. A step whose UI route is some other interface
just uses a `link` action and skips `console` entirely.

## Things handled for you (don't hand-roll these)

- **Status dot**: grey until anything is typed or ticked, amber while in progress, green once
  every non-`optional` step is ticked *and* tenant and product are both filled
  (`getOnboardingStatus` in `src/onboarding/index.ts`).
- **Route fallback**: a step with only one documented route shows it regardless of the switch,
  tagged — you never have to duplicate a route just to keep a step visible.
- **Persistence**: progress saves to `localStorage` under `onboarding:<x-onboarding-id>` on
  every change; nothing to wire up. The route preference and both base URLs are separate
  per-user keys (`step-path`, `jira-base-url`, `console-base-url`), since they belong to the
  reader rather than to the tenant being onboarded.
- **Seeding**: the tenant/product typed here can be pushed into the other pills' drafts with
  one button. It only writes `text` and `select-or-text` fields named `tenant` or `product`,
  and it reports exactly which pills it touched — see `src/onboarding/seed.ts`.

## Checklist after editing an onboarding file

```sh
npm run lint:schemas   # the meta-schema, plus every configId actually resolving
npm test               # src/onboarding/index.test.ts is the gate on the shipped files
npm run dev            # manually: tick steps, watch the YAML panel, paste it back
```

If you're changing the *format* rather than its content, the Zod schema in
`src/onboarding/types.ts` and the meta-schema in `src/onboarding/onboarding.meta.schema.json`
both need the change, and `src/onboarding/types.test.ts` is where a new rule earns a case.
