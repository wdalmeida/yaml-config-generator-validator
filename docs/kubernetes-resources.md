# Kubernetes Resources

The **Kubernetes** pill renders the cluster resources a tenant/product needs, templated from
those two values. It is not a config file type: there is no schema to validate against and no
file to push, so the pill is one-way — fill in the two inputs, copy the output, apply it.

```sh
kubectl apply -f -   # paste, then Ctrl-D
```

## What it renders

One multi-document YAML stream (`---` separated), all named from `<tenant>-<product>`:

| Resource | Name | Notes |
| --- | --- | --- |
| Namespace | `<tenant>-<product>` | Labelled `tenant` and `product`. |
| ServiceAccount ×2 | `<ns>-deployer`, `<ns>-reader` | |
| Role | `<ns>-role` | |
| RoleBinding | `<ns>-rolebinding` | Binds the Role to both service accounts. |
| Secret ×2 | `<ns>-<sa>-token` | `kubernetes.io/service-account-token`, annotated back to its account. |

## This is a placeholder

**The shape is what was described; the contents are guesses.** The RBAC rules, the two service
account names, and whether long-lived token Secrets are wanted at all have not been confirmed
against the real platform. Every guessed value is marked `# TODO: confirm` in the rendered
output itself — not just in the app's UI — so the warning survives a copy/paste into a
terminal.

To make it real, edit `src/kubernetes/manifests.ts`: the resources are built as plain objects
and stringified, so there is no template language to learn. `src/kubernetes/manifests.test.ts`
asserts the resource list, the naming, and the RoleBinding's subjects, so a change that breaks
the shape fails there.

Two notes on the placeholder specifically:

- The `Role` grants read-only access to a handful of core and `apps` resources. That is a
  deliberately unhelpful guess — it is not modelled on anything real.
- On Kubernetes 1.24+ a `ServiceAccount` no longer gets a token Secret automatically, and a
  short-lived projected token is usually preferred to the long-lived Secret rendered here.
  That's flagged in the output too.

## Name validation

Kubernetes object names are DNS-1123 labels, and the inputs are free text, so the pill
validates before it renders rather than handing over YAML `kubectl` will reject:

- The **namespace** is checked first and alone. Every other name derives from it, so a bad
  character in the tenant would otherwise be reported six times with the actual fix buried in
  the repetition.
- The **derived names** are then checked for length independently. A token Secret's name is six
  characters longer than its service account's, so a namespace short enough for one can still
  overflow the 63-character limit for the other.

## Where the inputs come from

The pill has its own tenant/product inputs, persisted under `draft:kubernetes` — the same
`draft:<id>` convention the config types use. That is deliberate: it makes the pill a
destination for the **Seed config drafts** button on the Onboarding checklist, so the two
values are typed once there and arrive here already filled. See
[Adding or updating onboarding steps](adding-onboarding-steps.md).

## What is stored, and what deliberately is not

Two things on this pill never reach `localStorage`, and both are tested rather than assumed.

**The rendered manifests.** They are re-derived from the inputs on every render and the output
field is `readOnly`, so there is nothing to store and nothing to paste into. The stream contains
ServiceAccount token Secrets — placeholders today, every one marked `# TODO: confirm`, but the
shape invites someone to fill a real one in before applying.

**Any input that is not on the allow-list.** `PERSISTED_KUBERNETES_KEYS` in
`src/kubernetes/index.ts` names the inputs that may be written — `tenant` and `product`, neither
of which is a secret by any reading. Everything else is held in component state for as long as
the tab is open and is dropped on the way to storage by `persistedKubernetesDraft`.

The direction is the point. These resources will eventually need a real secret typed in — a
registry credential, a token that already exists — and with a list of keys to *exclude*, adding
that input would persist it by default: the value simply appears in storage, readable by any
script on the origin and surviving the tab closing, with nothing to notice. With a list of keys
to *keep*, a new input is non-persisted the day it lands, and making it persistent requires
editing a line whose comment says what that costs.

Three consequences worth knowing before changing this:

- **`KubernetesWorkspace` does not use `usePersistedState`.** That hook writes back whatever the
  state object holds, which makes persistence the default for every key the draft carries. Here
  the draft is ordinary `useState` and the write is narrowed on the way out. Switching back to
  the hook to "tidy it up" removes the guarantee.
- **The narrowing runs on read too**, so a value an older build already wrote is scrubbed on the
  first write rather than being read back into state and re-saved.
- **`src/kubernetes/index.test.ts` pins the list's exact contents**, so growing it fails a test
  before it ships. Adding a key there is asserting that value is not a secret.

What this does *not* cover: the clipboard. **Copy all** puts the whole rendered stream on the
system clipboard, which is the point of the pill, and a secret filled into an input would be in
there with it. That is a deliberate user action with a visible result, not silent storage.

The config pills are a separate question with a different answer: a `ConfigWorkspace` does
persist its draft and its YAML field does accept paste, so anything typed there reaches
`localStorage`. That is the documented "switching types never loses work" behaviour.
