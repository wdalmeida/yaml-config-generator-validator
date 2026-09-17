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

There are three tiers, and the default is the strictest:

| Tier | Where | Lives until | What is on it |
| --- | --- | --- | --- |
| `PERSISTED_KUBERNETES_KEYS` | `localStorage` | cleared by hand | `tenant`, `product` |
| `SESSION_KUBERNETES_KEYS` | `sessionStorage` | the tab closes | `apiSecret` |
| *(neither list)* | memory only | the page unloads | anything added later |

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

### The API secret

`apiSecret` is the one input that is a secret by construction rather than by accident, and it is
on the **session** tier for a reason that cuts both ways. Keeping it out of `localStorage` is
obvious. Keeping it in `sessionStorage` rather than memory alone is the less obvious half: a value
that vanishes on every refresh is a value people copy somewhere more permanent and less careful — a
note file, a chat message to themselves — which is a worse outcome than the one being avoided.
Surviving a reload and not surviving the tab is the trade that avoids both.

This is not encryption and not isolation. While the tab is open, any script on the origin can read
`sessionStorage`. What it buys is that nothing is left on the machine afterwards.

Three details of the rendered Secret are deliberate:

- **`stringData`, not `data`.** Base64 is an encoding, not encryption. Writing the value out
  encoded would make it *look* protected while being exactly as readable, and `kubectl` accepts
  `stringData` directly. The output says so in a comment.
- **Blank means the Secret is omitted entirely**, not emitted empty. Applying
  `stringData: {api_secret: ""}` would cheerfully overwrite a real secret already in the cluster
  with nothing; an absent document cannot.
- **The document carries a "do not commit" banner.** Every other file this tool produces is meant
  to be committed to a repository. This one is the exception, and the warning has to survive the
  copy/paste into a terminal, so it lives in the YAML rather than only in the UI.

**The input is not masked, on purpose.** A `type="password"` box would be theatre here: the value
is rendered in plain text in the output panel a few hundred pixels to the right, because producing
that manifest is the entire point of the field. Masking the input while printing the value beside
it buys nothing and suggests a protection that isn't there. What the `secret: true` flag on the
`FieldDescriptor` does instead is real — `autocomplete="off"`, `autocorrect="off"` and
`spellcheck="false"`, each of which otherwise hands the value to machinery nobody chose (a password
manager, an autocorrect dictionary, a remote spell-checking service). If masking is wanted anyway,
it is a one-line change in `FieldRow` — flagging the reasoning, not refusing the request.

**Clear API secret** blanks the field and removes the `sessionStorage` key outright rather than
writing an empty value over it — an emptied blob under a key named `secret:kubernetes` still tells
a reader what used to be there. The removal lives in the persistence effect, not the button's
handler, so emptying the field by hand behaves identically instead of only the button being safe.

What this does *not* cover: the clipboard. **Copy all** puts the whole rendered stream on the
system clipboard, which is the point of the pill, and a secret filled into an input would be in
there with it. That is a deliberate user action with a visible result, not silent storage.

The config pills are a separate question with a different answer: a `ConfigWorkspace` does
persist its draft and its YAML field does accept paste, so anything typed there reaches
`localStorage`. That is the documented "switching types never loses work" behaviour.
