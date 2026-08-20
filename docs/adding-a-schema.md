# Adding or Updating a Config Schema

## Is there a schema file format (JSON Schema, YAML, etc.)?

**Yes - real [JSON Schema](https://json-schema.org/draft/2020-12/schema).** Each config type is
one `.json` file in `src/configs/schemas/`, written as a standard JSON Schema document. This is
hand-authored, static, and bundled at build time - not generated from code, and not fetched
from anywhere at runtime. Because it's a real (if narrow) subset of the actual standard, an
editor that recognizes the `$schema` URL (VS Code does, out of the box) will give you live
autocomplete and validation *while you write the file*.

**Dropping a new `.schema.json` file into `src/configs/schemas/` is the entire integration** -
`src/configs/index.ts` auto-discovers every file there via `import.meta.glob` and builds a
working config type (pill, form, validator, GitHub push) from it. No other file needs to
change. (Optionally add its `x-config-id` to the `DISPLAY_ORDER` array in `index.ts` if you
want it in a specific tab position - otherwise it just appears after the ones that are listed.)

A tiny converter (`src/configs/json-schema.ts`) derives *both* the Zod validator used for
parsing/validating and the form's field list from the same JSON Schema document - there's
exactly one place the shape of a config file is defined.

## The supported keyword subset

This app understands a deliberately narrow slice of JSON Schema - just enough for the config
files we generate. Using an unsupported keyword doesn't error loudly; it's silently ignored,
so double-check against this list rather than assuming something works because it's valid JSON
Schema in general.

**Root document:**

| Key | Meaning |
|---|---|
| `$schema` | Always `"https://json-schema.org/draft/2020-12/schema"` - standard, gets you editor tooling |
| `type` | Always `"object"` |
| `title` | The config type's display label (shown on its pill) |
| `properties` | The fields, keyed by name (see below) |
| `required` | Array of property names that must be present |
| `x-config-id` | Internal id (used in URLs/localStorage keys - keep it stable once set, changing it orphans existing users' saved drafts) |
| `x-default-filename` | The filename suggested when pushing to GitHub, e.g. `"protection.yml"` |
| `x-computed-groups` | Optional array of computed-field groups - see below |

**Per-property, by `type`:**

| `type` | Extra keywords | Renders as | Draft value |
|---|---|---|---|
| `"string"`, in `required` | `minLength`, `maxLength`, `pattern` | text input | `string` |
| `"string"`, **not** in `required` | `minLength`, `maxLength`, `pattern`, `x-placeholder` | checkbox that reveals a text input when ticked (`toggle-text`) | `string \| null` - `null` (unticked) means the key is entirely absent from the output, not an empty string; see below |
| `"string"` + `enum` | `enum: [...]` | dropdown (`select`) | `string`, restricted to `enum` |
| `"string"` + `enum` + `"x-widget": "select-or-text"` | `enum`, `maxLength` | Existing/New radio + dropdown or free-text input | `string` - `enum` is *suggested* options only, any string within `maxLength` validates |
| `"integer"` / `"number"` | `minimum`, `maximum` | number input | `number` (`"integer"` also rejects non-whole numbers) |
| `"boolean"` | - | checkbox | `boolean` |
| `"array"`, `items.type: "string"` | `minItems`, `items.pattern`/`minLength`/`maxLength` | repeatable text inputs (`list-string`) | `string[]` |
| `"array"`, `items.type: "object"` | `minItems`, `x-item-label`, `items.properties`/`required` | repeatable rows of nested fields (`list-object`) | `Record<string, unknown>[]` |

**Optional string fields are tick-to-reveal, not plain-and-blank-means-off.** Leaving a plain
optional text field blank and having it validate as "fine, just empty" is a common JSON Schema
footgun - `minLength` only applies when the key is *present*, so an easy mistake is a field that
silently accepts `""` when unticked. To avoid that entirely, any `"string"` property left out of
`required` renders as a checkbox + hidden text input instead of a bare (maybe-empty) text box:
unticked, the key is completely absent from the parsed output (matching the JSON Schema
`required` semantics exactly); ticked, a real value is expected and `minLength`/`pattern` still
apply.

**`x-computed-groups`: one shared input, several computed output fields.** Sometimes the user
shouldn't type a target field's value directly at all - they type one base value once, and tick
which computed variants to generate. `ci.schema.json` is the real example: the user types a
registry name once, ticks "Docker" and/or "Maven", and the app computes `registryDocker`/
`registryMaven` as `"${base}-docker"` / `"${base}-maven"` - there's no text box for the computed
value itself, so the user literally cannot set it to anything other than that pattern.

```json
"properties": {
  "registryDocker": { "type": "string", "title": "Docker registry", "minLength": 1 },
  "registryMaven": { "type": "string", "title": "Maven registry", "minLength": 1 }
},
"x-computed-groups": [
  {
    "label": "Registry name",
    "placeholder": "myregistry",
    "targets": [
      { "key": "registryDocker", "label": "Docker", "suffix": "docker" },
      { "key": "registryMaven", "label": "Maven", "suffix": "maven" }
    ]
  }
]
```

The target properties (`registryDocker`/`registryMaven`) still live in `properties` exactly like
any other optional string - that's what defines their validation and their real output key. The
group only changes how the *form* populates them: instead of two standalone tick-to-reveal
fields, it's one "Registry name" input plus a Docker/Maven checkbox pair. Ticking Docker without
typing a base value is a validation error ("Docker registry is required"), not a silently-wrong
`"-docker"` value - see `computed-toggle-group` in `src/configs/types.ts` for exactly how that's
enforced (`draftToCandidate` computes `''`, not the garbled suffix, when the base is blank).
Adding a third registry type is one more `targets` entry (plus its own property) - no new
converter code.

```yaml
runtime: node
# ...
registryDocker: myregistry-docker   # only present if that checkbox is ticked
```

**`x-*` vendor extensions** (spec-legal - any JSON Schema validator ignores unrecognized keys):
`x-config-id`, `x-default-filename`, `x-computed-groups` (root only), `x-widget` (currently only
`"select-or-text"` is a valid value), `x-placeholder` (input placeholder text - JSON Schema has
no keyword for this), `x-item-label` (the singular noun in a `list-object` array's "Add ___"
button, e.g. `"topic"` → "Add topic").

**Explicitly not supported** - don't reach for these, extend `json-schema.ts` first (and discuss
the design) if a real requirement needs one:
- `$ref` / definitions / anything requiring schema composition
- `oneOf` / `anyOf` / `allOf` / `not`
- conditionals (`if`/`then`/`else`)
- a computed field whose formula isn't "fixed base + fixed suffix, ticked independently" (that
  narrow case is `x-computed-groups`, above - anything more general is a new design discussion)
- cross-field validation beyond what `x-computed-groups` covers (a rule spanning more than one
  property - Zod's `.refine()` equivalent)

None of the five current config types need anything beyond what's documented here.

## Worked example: updating an existing (placeholder) schema

`ci.schema.json`, `cd.schema.json`, `env.schema.json`, and `protection.schema.json` are all
placeholders - guessed fields, not yet confirmed against the real config spec. Expect to edit
them. Say the real `protection.yml` spec caps `requiredApprovingReviews` at 3 (not 6) and adds a
new boolean `dismissStaleReviews`:

```diff
--- a/src/configs/schemas/protection.schema.json
+++ b/src/configs/schemas/protection.schema.json
@@
     "requiredApprovingReviews": {
       "type": "integer",
       "title": "Required approving reviews",
       "minimum": 1,
-      "maximum": 6
+      "maximum": 3
     },
@@
+    "dismissStaleReviews": {
+      "type": "boolean",
+      "title": "Dismiss stale reviews"
+    },
     "enforceAdmins": {
       "type": "boolean",
       "title": "Enforce for admins"
     }
   },
-  "required": ["branch", "requiredApprovingReviews", "requiredStatusChecks", "enforceAdmins"]
+  "required": ["branch", "requiredApprovingReviews", "requiredStatusChecks", "enforceAdmins", "dismissStaleReviews"]
```

That's the whole change - form, validator, YAML output, and GitHub push all pick it up
automatically on the next build/reload. No other file touched.

## Worked example: adding a brand-new config type

Create `src/configs/schemas/foo.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Foo",
  "x-config-id": "foo",
  "x-default-filename": "foo.yml",
  "type": "object",
  "properties": {
    "name": { "type": "string", "title": "Name", "minLength": 1 }
  },
  "required": ["name"]
}
```

Save it. That's it - it now appears as a pill with Generate/Validate, load-from-GitHub, and
push-to-GitHub all working identically to every other type. Add `"foo"` to `DISPLAY_ORDER` in
`src/configs/index.ts` only if you want it in a specific tab position.

## Things handled for you (don't hand-roll these)

- **Default values**: a fresh draft gets one blank row per array field, and the *first* `enum`
  entry for `select`/`select-or-text` fields (so e.g. tenant opens on "Existing: acme", not a
  blank "New" box) - see `emptyValueFor` in `src/configs/types.ts`.
- **Blank-row filtering**: an untouched array field (which starts with one empty row so there's
  something to type into) won't trigger "required" validation errors before the user does
  anything - see `draftToCandidate` in `src/configs/types.ts`. For a `list-object` array, a row
  counts as "blank" only by its text/select/array fields - a checkbox alone being toggled
  doesn't count (`objectHasContent` - this has a dedicated test in
  `src/configs/types.test.ts`, since the boolean-exclusion is easy to get backwards).
- **`x-widget: "select-or-text"` validation**: the field stays a plain (length-bounded) string
  under the hood, not a strict `z.enum()` - so a custom value the user types in the "New" side
  is just as valid as one of the suggested options.
- **`toggle-text` omission**: `draftToCandidate` drops the key entirely when its draft value is
  `null` (unticked), rather than passing through an empty string - this is what makes an
  unticked optional field truly absent instead of failing `minLength` or silently passing an
  empty value through.
- **`computed-toggle-group` fan-out**: this one field's own key never appears in the output -
  `draftToCandidate` expands it into each ticked target's real key, computed as
  `${base}-${suffix}`, and omits any target that isn't ticked. A ticked target with a blank base
  becomes `''` (a real validation error), not the computed-looking-but-wrong `"-docker"`.

## Checklist after editing a schema file

```sh
npm run build   # tsc catches most structural mistakes early (missing required keys, etc.)
npm test        # npx vitest run src/configs/json-schema.test.ts covers the converter itself;
                # src/configs/types.test.ts covers the shared draft-filtering helpers
npm run dev     # manually: pick the pill, fill the form, check Output YAML, and paste a
                # matching file into the left column's Load & validate box to check it too
```

If you're changing converter behavior itself (not just editing a schema file's content), add a
case to `src/configs/json-schema.test.ts` - it's the test suite that actually exercises every
supported keyword combination (enum vs. `select-or-text`, `pattern`, integer bounds, nested
`list-object` fields, `required` vs. optional).
