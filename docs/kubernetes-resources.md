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
