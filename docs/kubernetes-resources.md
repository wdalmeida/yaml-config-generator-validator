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

There are two tiers, and the default is the strict one:

| Tier | Where | Lives until | What is on it |
| --- | --- | --- | --- |
| `PERSISTED_KUBERNETES_KEYS` | `localStorage` | cleared by hand | `tenant`, `product` |
| *(not on the list)* | memory only | the page unloads | `apiSecret`, and anything added later |

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
stored **nowhere**: it lives in component state and is written to no browser store.

**`sessionStorage` was built for this value and then removed**, which is worth recording because it
looks like the obvious answer. It is scoped to one tab and dropped when that tab closes, so it
reads as a reasonable middle ground. It is not, against the threat that actually matters here. A
`sessionStorage` entry is readable by any script running on the origin for as long as the tab is
open — a compromised dependency, an injected script, anything else on the page — so it offers no
protection against the thing most likely to go after a credential. What it does add is a window
during which the value sits somewhere enumerable by key. Component state is not immune either, but
it is not enumerable and it does not survive a reload.

**The cost is real, and was accepted deliberately**: the secret is gone on reload, on navigating
away, and on switching to another pill, since `App` mounts one workspace at a time. The note beside
the field says so in as many words — the failure mode to avoid is someone discovering it by losing
a value they had pasted and no longer have. Copy the output before leaving the page.

`SECRET_KUBERNETES_KEYS` is **derived** from the field descriptors (`secret: true`) rather than
written out a second time, so marking a new field secret is the only edit needed to bring it under
this rule, and a test asserts the two lists never share a key.

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

**The secret is masked, in both places at once.** The field is a `type="password"` box and the
rendered manifest shows `api_secret: ••••••••`, governed by one **Show secret** / **Hide secret**
button. Masking only the input would have been theatre — the value is rendered a few hundred pixels
to the right, because producing that manifest is the point of the field — so the toggle covers the
panel too or it covers nothing. It starts masked on every visit and the choice is not remembered.

Bullets rather than asterisks: `*` opens an alias in YAML, so a run of them comes back quoted
(`"********"`) and reads like a value somebody meant to type. The mask is a **fixed length**
regardless of the real one, because a mask that matches the secret's length leaks the secret's
length.

**Copying is deliberately exempt.** `Copy all` re-renders unmasked and puts the real value on the
clipboard even while the panel shows bullets. The alternative is worse than it looks: copying the
mask would create a Secret holding literal bullets, and that failure surfaces far from this page,
inside a cluster, as an application that cannot authenticate. So what you see is not always what
you copy — which is a genuine trap, and the reason the panel says so above the output and the
status line says so again after the copy.

The `secret: true` flag on the `FieldDescriptor` also turns off `autocomplete`, `autocorrect` and
`spellcheck`, each of which otherwise hands the value to machinery nobody chose (a password
manager, an autocorrect dictionary, a remote spell-checking service). `FieldRow`'s `revealSecret`
prop defaults to `false`, so a secret field added anywhere else is masked unless something
deliberately asks otherwise.

**Clear secrets** blanks every field marked `secret: true` and the rendered output. It is named for
the category rather than for today's single field, so a second secret input is covered without the
label quietly becoming a lie. There is no storage for it to clear; it exists because the value is on
screen until something removes it, and "I am about to share this screen" is the case it is for.

## Naming the namespace

The namespace is `<tenant>-<product>` unless the **Namespace** field is filled in, in which case
that name is used verbatim. Every other object is named from the namespace, so an override moves
all of them — the ServiceAccounts, their token Secrets, the Role, the RoleBinding and the API
Secret — rather than relabelling one object and leaving the rest pointing at the old name.

Three things about it:

- **Tenant and product are still required.** They are the identity, not just raw material for a
  name: they label the Namespace object, they are what the onboarding checklist seeds, and the
  override renames the namespace rather than replacing what it stands for.
- **A typed namespace gets the same DNS-1123 check as a derived one.** It is free text on the way
  in exactly like the tenant is, and being specific about a name is not evidence that it is legal.
- **It is on the storage allow-list.** A namespace is a name, not a secret. Adding it there was a
  deliberate edit that failed `src/kubernetes/index.test.ts` first, which is the mechanism working:
  the pinned list is what makes "is this a secret?" a question somebody has to answer.

The form shows the derived value live, spelled `<tenant>-<product>` while those are empty — with
both blank the derivation is literally `-`, which shown on its own reads as a bug rather than as a
template.

What this does *not* cover: the clipboard. **Copy all** puts the whole rendered stream on the
system clipboard, which is the point of the pill, and a secret filled into an input would be in
there with it. That is a deliberate user action with a visible result, not silent storage.

The config pills are a separate question with a different answer: a `ConfigWorkspace` does
persist its draft and its YAML field does accept paste, so anything typed there reaches
`localStorage`. That is the documented "switching types never loses work" behaviour.
