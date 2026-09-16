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
| Colour vision | dichromacy simulation + CIEDE2000 (`src/App.colorblind.test.tsx`) | the same tokens, simulated for three deficiencies | two states that mean different things but look the same |

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

## Colour vision

Contrast and colour-vision deficiency are different questions, and passing the first says
nothing about the second: two colours can each clear 4.5:1 against the background and be
indistinguishable *from each other*. Deuteranomaly and protanomaly together affect roughly **1
in 12 men**, so this is not an edge case.

`src/App.colorblind.test.tsx` simulates each palette for protanopia, deuteranopia and tritanopia
using the Machado, Oliveira & Fernandes (2009) matrices, then measures CIEDE2000 between the
colours that encode mutually exclusive states. Below about **11** two colours of similar
lightness are not reliably told apart — a working threshold, not a standard: the CIE's own "just
noticeable" is far smaller, but picking one of several discrete states out of a UI needs more
margin than spotting that two swatches differ side by side.

The pill status marks failed it outright:

```text
BEFORE                                          AFTER
 6.6  muted  vs success  (protanopia)           12.1   (light)   16.0  (dark)
 8.6  warn   vs success  (protanopia)           24.2   (light)   26.5  (dark)
```

Amber against green is the pairing that disappears, and it was carrying *"in progress"* against
*"valid"*. Two things changed:

**`--success` moved off the green axis to a teal** (`#115e59` light, `#5eead4` dark). Teal puts
the difference on the blue axis, which protanopes and deuteranopes still see. It still reads as
"good", which a blue would not.

**The status mark became a shape.** This is the part that actually matters. Three silhouettes —
an empty ring, a half-filled ring, a tick — instead of one circle in three colours. A shape
survives every deficiency including monochromacy, survives a greyscale print and a washed-out
projector, and needs no palette to be lucky. The colour now agrees with the shape rather than
being the message, which is what WCAG 1.4.1 asks for.

### What is still close, and why that is fine

Some warm pairs remain near each other under simulation — `--error` against `--accent-strong` is
2.5 for a deuteranope in dark mode:

```text
LIGHT   2.3  warn  vs accent-strong  (tritanopia)
        5.8  warn  vs error          (deuteranopia)
DARK    2.5  error vs accent-strong  (deuteranopia)
```

These are deliberately **not** asserted. They are not contrastive: `--accent-strong` is button,
link and focus chrome, `--error` is validation text, `--warn` is a status. Nobody has to tell a
button's colour from an error message to understand the page — they are different components in
different places, never two readings of the same element. Requiring every pair to separate would
force the palette into four unrelated hues and buy nothing. The test asserts within
`CONTRASTIVE_SETS` for exactly that reason, and the sets are the thing to extend when a new
state is added.

The simulation itself is guarded too: a run that mangled the matrices would report huge
differences and pass everything vacuously, so there are two checks that red and green do collapse
for a deuteranope, and that a neutral grey comes through untouched.

## The theme switch, and why there is no colourblind mode

The header carries a three-way **Auto / Light / Dark** radiogroup (`src/components/ThemeSwitch.tsx`,
persisted under `theme`). Auto is the default and is the *absence* of a choice: no `data-theme`
attribute, so `prefers-color-scheme` decides and the page keeps following the OS when it flips at
sunset. The other two are an override that has to beat the OS in both directions, which is why
`App.css` states the dark palette twice — once inside the media query guarded with
`:not([data-theme='light'])`, once as `:root[data-theme='dark']`. CSS cannot share a declaration
block between a media query and a plain rule, and `light-dark()` resolves to nothing at all on a
browser that does not know it, which would take the whole palette down rather than degrade.
`App.contrast.test.ts` asserts the two copies are identical so the duplication cannot drift.

The choice is applied in `main.tsx` **before the first render**, not in an effect. An effect runs
after paint, so a reader whose theme is the opposite of their OS would get one frame of the wrong
palette on every load. The usual fix is an inline `<script>` in `index.html`; this app cannot use
one, because `container/nginx.conf`'s CSP is `default-src 'self'` with no `unsafe-inline` for
scripts and the browser would refuse to run it.

**There is deliberately no separate colourblind palette.** It was considered and rejected:

- **The states are not carried by colour any more.** Each pill status has its own shape, and
  every one is also stated in words. A palette toggle would be a third encoding of something
  already encoded twice, and it would do nothing for monochromacy, a greyscale print, or a
  projector.
- **The pairs it could improve are not contrastive.** After the teal, everything that encodes a
  mutually exclusive state clears the threshold. What is still close — `--error` against
  `--accent-strong` — is validation text against button chrome. Nobody has to tell those apart to
  understand the page, so a mode that separated them would buy nothing.
- **It would be a third palette to maintain and test**, behind a setting most people never find,
  which is the failure mode of accessibility-as-a-mode: the default stays mediocre because the
  toggle exists. The default is the thing that has to be right.

If a future state genuinely cannot be given a shape, the answer is to add it to
`CONTRASTIVE_SETS` in `App.colorblind.test.tsx` and fix the default palette until it passes —
not to add a mode.

### One focus ring, and why it sets no radius

Everything focusable shares one `:focus-visible` rule — the pills, the text fields, the buttons,
the links. `.theme-switch` is the single exception, and only because its radios are clipped out
of sight: the ring has to go on the strip (`:focus-within`) rather than on an invisible input.

The rule sets a colour and an offset and **deliberately no `border-radius`**. An outline already
follows the element's own border curve, so one buys nothing — and on a blanket rule it *replaces*
the element's radius for as long as it has focus. `.config-tab` is `border-radius: 999px`, so
tabbing to a pill snapped it from a capsule to an 8px rounded rectangle: that reads as the layout
glitching, not as a focus indicator. `App.layout.test.ts` asserts it stays out.

The ring is `--accent-strong` rather than `--accent`, which matters here: a focus indicator is a
non-text UI component and WCAG 1.4.11 asks 3:1 of it, and the brand orange is 2.99:1 on the page
background — under the bar by a hair, on the one thing that should never be marginal.

## Scrolling and reflow

`.yaml-panel` is a sticky flex column with `max-height: calc(100vh - 48px)`. It has to clip, and
the field inside it has to be allowed to shrink:

```css
.yaml-panel      { overflow: hidden; }
.yaml-editor-host { flex: 1 1 240px; min-height: 0; }
```

Both halves are load-bearing. A flex item will not shrink below its `min-height`, which defaulted
to a hard `240px`, so once the panel's contents exceeded `max-height` the overflow was laid out
past the panel's bottom edge with **no scroll container anywhere** — it ran off the box and over
whatever was beneath it. The Kubernetes pill showed it worst: an extra warning paragraph eating
the height, and about a hundred lines of manifests. `flex: 1 1 240px` keeps the field opening at a
usable size while letting it give way; CodeMirror's own `.cm-scroller` then does the scrolling.

Inline `<code>` gets the same treatment for the horizontal axis. A file path and a shell command
are single unbreakable tokens; left alone they push their container wider than the column and the
whole document gains a horizontal scrollbar, which WCAG 1.4.10 rules out. `.github-path code` and
`.step-command code` scroll in their own box, and `.step-command` carries `min-width: 0` so they
are allowed to — the same trap as `min-height` above.

`src/App.layout.test.ts` asserts every one of those declarations. **It cannot assert that
anything actually scrolls**: jsdom performs no layout, every element is 0×0 and nothing overflows
anything. Confirming the behaviour is step 6 of the manual pass below.

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
5. **Make the window short** (about 500px tall) with the columns side by side, open the
   Kubernetes pill, and fill in a tenant and a product. The manifests must scroll *inside* the
   panel; nothing should be drawn below the panel's bottom edge, and the page itself should not
   gain a horizontal scrollbar. Then try a very long `owner/repo` — the path should scroll in its
   own box rather than widening the card.
6. **Cycle the theme switch** through Light, Dark and Auto with your OS on the opposite setting,
   and reload on each. There should be no flash of the wrong palette, and the scrollbars and
   `<select>` popups should match the page.
7. **Look at it in greyscale.** macOS: System Settings → Accessibility → Display → Colour
   Filters → Greyscale. Every state should still be readable. If two things become the same
   thing, colour was carrying meaning on its own somewhere.
8. **Zoom to 200%** and then to 400% (WCAG 1.4.10 asks for 320px-equivalent reflow). The columns
   collapse at 860px; nothing should need horizontal scrolling except the YAML field.
9. **Switch to dark mode** and repeat 1 and 3. The palette differs, and `--muted` was wrong there
   for the whole life of dark mode without anyone noticing.
10. **Turn on Windows High Contrast / forced colors** if you have it. The focus ring is re-stated
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
| Status shown only by a dot's colour; amber vs green **8.6** simulated for protanopia | 1.4.1 | three shapes (ring, half-ring, tick), and `--success` moved to a teal |
| Input and button borders at **1.42:1** | 1.4.11 | `--border-control`, separate from the decorative `--border` a card uses |

## The things most likely to be undone

- **`--success` is a teal on purpose.** "Use green for success" is the obvious edit for anyone
  who does not know why. Green against the amber beside it measures 8.6 simulated for
  protanopia; `App.colorblind.test.tsx` fails on it by name for that reason.
- **The status mark is a shape first.** Replacing the three SVGs with one coloured circle puts
  the state back into colour alone, whatever the palette is.
- **`--accent` and `--accent-strong` are not redundant.** The brand orange is fine for a border
  or a dot and fails as text. Collapsing them back into one token puts the app straight back to
  2.99:1, and `App.contrast.test.ts` asserts the split itself for that reason.
- **`.visually-hidden` is not `display: none`.** Both hide the element visually; `display: none`
  also removes it from the accessibility tree, which is the exact opposite of the point.
