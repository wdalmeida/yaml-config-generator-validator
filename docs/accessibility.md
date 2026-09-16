# Accessibility

The target is **WCAG 2.2 level AA**. This page is what that means here: what is checked
automatically, what the automation cannot see, and what was actually wrong when the first pass
was done.

## What checks what

Three things run on every push and PR, and they answer different questions.

| | Tool | Sees | Catches |
|---|---|---|---|
| Authoring | [oxlint](https://oxc.rs)'s `jsx-a11y` plugin (`npm run lint`) | one JSX element at a time, in the source | a missing `alt`, an ARIA attribute on an element that cannot carry it, a `<label>` written next to its input inline |
| Rendered | [axe-core](https://github.com/dequelabs/axe-core) over the real component trees (`src/App.a11y.test.tsx`) | the DOM React actually produces | a control with no accessible name, a duplicated id, a heading level skipped, a landmark violation |
| Palette | contrast ratios computed from `src/App.css` (`src/App.contrast.test.ts`) | the custom properties themselves, in both themes | text or a focus ring below the WCAG ratio |

**The middle row is the one that was missing**, and its absence is the reason this document
exists. `CLAUDE.md` had flagged it: jsx-a11y is *"authoring-time only, not a runtime/rendered
check like axe-core would be — a deliberate scope choice given the app's current size, revisit
if that's ever not enough."* It was not enough.

`FieldRow` rendered its label as a **sibling** with no `htmlFor`:

```jsx
<div className="field-row">
  <label>{label}</label>   {/* names nothing at all */}
  {control}
</div>
```

**Seven of the twelve controls on the Tenant Config screen had no accessible name**, and four
`<label>` elements named nothing. jsx-a11y did not report it — its
`label-has-associated-control` fires on that exact shape written inline, but the label and the
control here are assembled by a helper function, so the rule never sees them together. Nothing
else in the repo could have caught it. Reintroducing the bug today fails five axe tests while
`npm run lint` still exits 0.

## What a passing run does not prove

Roughly a third of WCAG is machine-checkable. axe is very good at that third and blind to the
rest. It cannot tell you whether a label *reads* sensibly, whether focus order matches the
visual order, whether an `aria-live` region fires at a useful moment, or whether an error
message explains anything. **Treat a green run as "no known defects", never as "accessible".**

Two rules are disabled under jsdom, both for real reasons rather than convenience — see
`src/test-a11y.ts`:

- **`color-contrast`** needs layout and computed styles, and jsdom applies no stylesheet, so
  everything resolves to transparent on transparent. Checked against the tokens instead, which
  is the more honest place for constants and covers dark mode without a second browser run.
- **`region`** (all content inside a landmark) fires on every component test, because a test
  renders one component into a bare `<div>` rather than the page that supplies `<main>`. It is
  re-enabled for the full-`App` render, where the question is meaningful.

## The manual pass

Do this before shipping anything that changes the shape of a screen. None of it is automated
and none of it is optional.

```sh
npm run dev
```

1. **Unplug the mouse.** Tab from the address bar. The skip link should be first. Every control
   should be reachable, in an order that matches what you see, with a focus ring you can find
   without looking for it. Nothing should trap focus.
2. **Tab into the YAML editor.** It is a CodeMirror `contenteditable`, not a `<textarea>` — the
   ring is drawn on the wrapper, and `Escape` then `Tab` gets you out.
3. **Turn the screen reader on** (VoiceOver: `Cmd+F5`; NVDA on Windows). Move
   through the pill strip: each should read its label, its status, and "current page" on the
   open one. Move through a form: every field should read its own label, and a list row should
   say which row it is.
4. **Copy something.** The confirmation is a live region, so it is announced without moving
   focus. If you hear nothing, it regressed.
5. **Zoom to 200%** and then to 400% (WCAG 1.4.10 asks for 320px-equivalent reflow). The columns
   collapse at 860px; nothing should need horizontal scrolling except the YAML field.
6. **Switch to dark mode** and repeat 1 and 3. The palette differs, and `--muted` was wrong there
   for the whole life of dark mode without anyone noticing.
7. **Turn on Windows High Contrast / forced colors** if you have it. The focus ring is re-stated
   in `Highlight` for this; most other colour is given up to the OS by design.

## What was fixed in the first pass

Kept as a record of what these checks are guarding, and because several are the kind of thing
that gets undone by a well-meaning refactor.

| Problem | WCAG | Fix |
|---|---|---|
| `FieldRow`'s label named nothing; 7 of 12 controls anonymous | 1.3.1, 4.1.2 | `useId` + `htmlFor` for single controls; `<fieldset>`/`<legend>` for groups, since a label may name exactly one control |
| Nested list rows had a placeholder and no label | 3.3.2 | `aria-label` naming the field *and* the row ("name, topic 3") |
| Every list row had a button called just "Remove" | 2.4.6 | `aria-label` naming what it removes; still starts with the visible word, which 2.5.3 requires |
| The YAML editor removed its focus ring and put nothing back | 2.4.7 | ring moved to the wrapper so it traces the gutter too |
| The YAML editor was an unnamed edit box | 4.1.2 | `EditorView.contentAttributes` with an `aria-label`; the `Suspense` fallback `<textarea>` got the same name |
| The open pill was marked only by a CSS class | 4.1.2 | `aria-current="page"` — deliberately not `role="tab"`, which would oblige arrow-key roving focus and `aria-controls` to match the pattern's contract |
| The status dot's colour was the only carrier of its state | 1.4.1 | visually-hidden text in the pill's name |
| Outbound links opened a new tab silently | 3.2.5 | `ExternalLink`, which appends ", opens in a new tab" |
| Copying said nothing to anyone not watching | 4.1.3 | `CopyButton`, with an `<output>` live region |
| No skip link past six pills | 2.4.1 | one, focusable and visible only when focused |
| `<title>` was the repo slug | 2.4.2 | a real page title |
| Brand orange as text: **2.99:1**; white on it: **3.12:1** | 1.4.3 | `--accent-strong`, same hue and saturation, walked down in lightness until it passes. `--accent` stays the brand colour for lines and dots, which only need 3:1 |
| `--muted` never redefined for dark: **3.24:1** | 1.4.3 | a dark-mode value. The dark block had overridden every other colour token |
| Input and button borders at **1.42:1** | 1.4.11 | `--border-control`, separate from the decorative `--border` a card uses |

## The two things most likely to be undone

- **`--accent` and `--accent-strong` are not redundant.** The brand orange is fine for a border
  or a dot and fails as text. Collapsing them back into one token puts the app straight back to
  2.99:1, and `App.contrast.test.ts` asserts the split itself for that reason.
- **`.visually-hidden` is not `display: none`.** Both hide the element visually; `display: none`
  also removes it from the accessibility tree, which is the exact opposite of the point.
