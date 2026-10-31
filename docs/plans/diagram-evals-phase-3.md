# Diagram evals — phase 3: the style flag and the mechanism style

Part of ER-62; the plan of plans is `diagram-evals.md`. Same branch and PR.
Deleted when the work lands.

## What changes for a reviewer

`er review --diagram-style <mechanism|files>`, default `mechanism`. `files`
is today's diagrams. `mechanism` draws the parts of the system the change
moves through, each named by what it does, with the untouched parts around
the change drawn and grounded in their own files. One style per run.

## Pieces

- **The flag.** Parsed beside `--overview-style` and refused the same way
  with a `--from` past the prompt stage. It travels in the run folder's
  `styles.json`, which becomes `{ "overview": [...], "diagrams": "mechanism" }`
  (no old shape is read), so `--from` reuses it. The prompt stage line names
  it when it is not the default.
- **The instructions.** The Diagrams section of the system prompt keeps what
  holds in either style: the structure, the four kinds, when a picture earns
  its place, sizes, captions, the sequence and before-and-after rules, the
  overview's altitude. What differs moves to a "Diagram style" section of the
  run's own prompt, like an overview style, so `system.md` stays the same on
  every run and is read from cache:
  - `files`: today's sentences on labels and grounding, word for word: a
    node is a name, a code node may carry a path from Files Changed, draw
    only what the diff and the description support.
  - `mechanism`: a node is a part of the running system named by its
    responsibility ("Card gateway", "Retry sweep", "Packing worker"), never
    by an identifier, which goes in its `filename`; the overview shows the
    change inside the system around it, so most of its nodes are the
    untouched parts the change attaches to, reads, hands off to or is
    called by; an unchanged node is grounded in the file that holds it,
    anywhere in the repository, once that file has been read; edges say what
    passes along them; a chapter's picture may stay inside the change.
- **Grounding outside the diff.** A node's `filename` may name a file the
  change does not touch, on an `unchanged` node only, as a plain path from
  the repository root, with no hunk ids. `data` nodes may carry a filename as
  `code` nodes do (a queue or a table lives in a file; the hand-run's parser
  dropped exactly that), `external` and `actor` still may not. The parser
  checks the shape; the parse stage checks the file is a blob at the head
  commit with git, as it does for excerpts, and drops a filename that is not,
  in the review's `diagram-part-dropped` note.
- **The reader.** A grounded node draws its path beneath its label in the
  edge type, mono, unless the label already is the path or its file name.
  Only a node whose file is one of the review's changed files is clickable;
  an untouched file has nothing in the report to open.
- **The eval.** `run --diagram-style`, recorded in `run.json` and shown on
  the sheet, so the baseline can be swept as `files` from the same code.

## A locked decision narrowed

The plan of plans grounds an unchanged node with an optional line span,
embedded in the bundle like an excerpt, so a click could open it. This phase
grounds by path alone: the path under the label is what answers "where is
this", and the span and the click-through are worth building only once the
sheet shows the model grounds untouched nodes well. If it does, they follow
as the last step of this work, before the PR.

## Done when

Both styles run end to end; tests cover the flag, `styles.json`, both
prompt sections, the parser's outside-diff grounding, the parse stage's git
check and the subline; the gate is green; a sweep of each style is compared
on the contact sheet (with the API key).
