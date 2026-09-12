---
paths:
  - 'src/web/**/*.tsx'
  - 'src/web/**/*.css'
  - 'src/web/theme/**'
  - 'src/guardrails/palette.guard.test.ts'
  - 'src/guardrails/diagram-colour.guard.test.ts'
---

# Design system

Loaded when you open a component, route, stylesheet or theme file. The
`palette` guardrail enforces most of what follows, and `diagram-colour` holds
SVG attributes to `token()` only (no literal, no raw `var(--er-`, no colour
word).

Two rules, both enforced by the `palette` guardrail, both the result of the
reader growing twelve font sizes and nine near-identical label styles:

- **Six font sizes, no more.** `FONT_SIZES` (Mantine's `xs`–`xl`: 11/13/15/19/28)
  plus `DISPLAY_SIZE` (40) for page and chapter titles. Use `fz="sm"` or
  `var(--mantine-font-size-sm)`, never a literal `fz={13}` or `font-size: 13px`.
- **One uppercase label.** `components/caption.tsx`; it varies only by `tone`.
  A component that needs the treatment without the component (a Mantine
  `Badge`, say) reads `CAPTION_TYPE` rather than respelling the values.

**One reading measure.** In the reader, every block — heading, card, prose,
caption — sits in a single column capped at `--er-measure` (42rem) via
`narrative/article.module.css`, so they share one right edge. Only a diff or a
code block opts out, with `data-bleed`, and spans the rest of the column: those
are the only things here that read better wide, and they are what the width
toggle is for. Do not give a prose block its own `max-width` — that
is what had text wrapping near the middle of a much wider card, lined up with
nothing.

Two widths on the page, and no more: the measure, and the full column. A third
lane sized between them — cards ending somewhere after the prose but before the
diffs — reads as confusion rather than hierarchy. That is why card grids
(insights, risk factors) stack in one column instead of widening: measured on a
real review, stacking cost 131px on six risk factors and _saved_ 96px on the
insights, because a full-measure card wraps to fewer lines and a two-up grid
equalises its rows to the tallest cell.

**Two page widths, and the reader gets the choice.** Every page inside the
shell renders through `components/page-shell.tsx`, which is also where the
topbar's inner bar gets its `maw` and `px`, so the header lines up with the page
beneath it and moves with it. Which width a page takes is a `ShellWidth`:

- `reader` follows `--review-max-width`, the topbar toggle's `full` (the
  window) ⇄ `wide` (110rem). The reader is the only page that earns it: a
  side-by-side diff splits its column in two, so every pixel it is given is
  worth having, and at the old 92rem default a reviewer scrolled sideways more
  than they read.
- `page`, the default, is a fixed `PAGE_MAX_WIDTH` (92rem). A composer field or
  a history row stretched across a 3400px monitor is worse, not better.

A page declares itself the reader through the route `handle` in
`lib/reader-route.ts`, which is also what tells the topbar to offer the width
and diff-view toggles at all — a control that visibly does nothing is worse than
no control. The same principle runs one level deeper: below
`SIDE_BY_SIDE_MIN_WIDTH` the column cannot carry two panes, so the diff toggle
shows the stacked state and disables rather than claiming a view the page is not
in. `chapter-reader.tsx` measures that column once and `selectSpaceLimited`
derives it, so the icon, the disabled state and the editors' `renderSideBySide`
all come off one number and cannot disagree. The measurement lives in its own
un-persisted store beside the preference — it arrives once per frame while the
sidebar is dragged, and only a preference belongs in storage. Widening the shell
is still not the same as widening the text: prose keeps its own measure in `ch`,
and a page whose content gains nothing from the extra room (the job timeline)
caps itself and stays left-aligned so the left edge never jumps between pages.
Do not reintroduce a per-route
`Container size={...}` — that is what made the toggle look broken everywhere
outside the reader. `PageShell` pads the bottom more than the top (`SHELL_PB`):
a page that ends flush with its last element reads as cut off.

Two text families: sans for everything, mono for identifiers, paths, SHAs and
code. There is no display serif.

Colour is semantic tokens only (`token('muted-foreground')`, never a literal or
a `color-mix` off `foreground`). Body text is `foreground`; anything secondary
is `muted-foreground` — those two greys are the whole vocabulary. `subtle` is
placeholder and decoration, never text. Text on a `-soft` fill takes the
matching `-ink` — enforced, not merely advised: the guardrail treats every
`-soft` as a ground in its own right and scans components for a page-ground
colour under an unconditional tint fill. The base accents are tuned against the
page, not against tints (`risk` on `before-soft` is 4.01:1 in dark), so reaching
for one on a fill ships text under AA. A tint is also a poor state cue — no page
ground clears 3:1 against `before-soft` — so a selected control on a tint gets a
`before` ring rather than a paler fill. `border` draws cards and dividers;
`border-strong` (≥ 3:1) is for control boundaries and is what Mantine's
`default-border` resolves to.

**Every token that carries text clears WCAG AA against all four grounds of its
own scheme — `background`, `card`, `surface-2` and `muted` — every `-ink`
clears AA on its own `-soft`, and every token is inside the sRGB gamut.** All
four grounds, not just the page: a colour fitted only against `background`
fails the moment it lands on a chip or a list row, which is how the filter
chips shipped at 4.37:1. The two schemes therefore hold different accent
values — a mint that reads on a dark card cannot also read on white, which is
how the previous palette came to fail light mode. When changing a colour, run
`npm test` and let the guardrail do the arithmetic. Disabled controls are
exempt (WCAG 1.4.3) and the guardrail does not look at them.
