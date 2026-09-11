---
name: linear
description: How this repo tracks bug and feature work in Linear (team enhanced-reviews, key ER). Use when starting a bug fix or feature, when a bug or feature idea turns up out of scope, when opening a PR for tracked work, and when that work is finished or abandoned. Covers finding or creating the issue, branch and PR naming, checkpoint updates, screenshots and status changes. Not for housekeeping (agent config, docs, tooling, small cleanups), which gets no issue.
---

# Linear workflow

The backlog and all in-flight bug and feature work live in Linear, in the team
**enhanced-reviews** (key `ER`, issues `ER-<n>`,
https://linear.app/lemon-dev/team/ER/active), which you reach through the
Linear MCP server. The team has no projects or cycles. Its labels are
`Feature`, `Improvement` and `Bug`. Its statuses are `Backlog` → `Todo` →
`In Progress` → `In Review` → `Done`, plus `Canceled` and `Duplicate`. If the
Linear tools are not connected in your session, tell the user rather than
silently skipping any of the steps below.

**What gets an issue** is set out in `AGENTS.md`: bugs, features and
improvements to the app do; housekeeping does not. Everything below applies
only to work that gets one.

- **Backlog items go to Linear, not to the repo.** When an out-of-scope bug or
  feature turns up (a follow-up, a bug noticed in passing, something the user
  says to do "later"), search `ER` for an existing issue first and comment on
  it if one covers the work. Otherwise create one in `Backlog` with one label
  and a description that stands on its own: what was seen, where (file paths,
  routes), why it matters, and what done looks like. Do not record backlog
  items as TODO comments or as lists under `docs/`. Tell the user the
  identifier. Leave priority unset and do not move items to `Todo`: triage is
  the user's call. Out-of-scope housekeeping is not filed; mention it to the
  user instead.
- **Starting a task: find its issue first.** If the user names an issue, read
  it and its comments before planning. If they do not, search `ER` by keyword
  across every status, since the issue may already be sitting in `Backlog`. If
  nothing matches, create one. Then assign it to the user (`me`) and move it
  to `In Progress`. Questions, investigations that change nothing, and
  follow-ups inside a task that is already tracked do not get their own issue.
- **Branches and PRs carry the identifier.** Name the branch
  `<type>/er-<n>-<slug>` (for example `feat/er-8-soft-wrap-diffs`), put
  `Fixes ER-<n>` in the PR description (`Part of ER-<n>` if the PR only
  partly delivers the issue), and add the PR to the issue as a link.
  Commit messages keep the repo's own style. Do not rely on Linear's GitHub
  integration to move statuses: set them yourself.
- **Update the issue at checkpoints only.** There are three: the plan is
  agreed, the PR is opened, and the work is finished. Do not write to Linear
  between them. The description is the current truth: goal, agreed approach
  and acceptance criteria. Edit it with `patch` at a checkpoint so it matches
  what was actually built, folding in any scope change since the last one.
  Comments are the log: a short note per checkpoint on what changed and what
  is left.
- **Screenshots for anything visible.** When a change shows up in the UI,
  attach screenshots when the PR opens (before/after, and light/dark if
  theming changed). Capture them to a file, because the upload needs one: the
  Playwright MCP's `browser_take_screenshot` writes a file, while the Browser
  pane's screenshot only returns an image to the conversation. Save them under
  `screenshots/`, which is gitignored. To upload a file, call
  `prepare_attachment_upload` with the file's exact byte size,
  `curl -X PUT --data-binary @file` to the returned URL sending every returned
  header verbatim within 60 s, then call `create_attachment_from_upload`.
  Upload one file at a time. Embed the `assetUrl` in the checkpoint comment as
  `![caption](assetUrl)` so the image shows inline.
- **Status follows the work.** Starting work moves the issue to
  `In Progress`, and opening a PR moves it to `In Review` with a comment
  summarising the change. Once the PR is merged (the user merges), move it to
  `Done`. If the work stops at local commits because nobody asked for a push,
  it stays `In Progress`: say so. Abandoned work goes to `Canceled` with a
  comment explaining why, and a duplicate is marked `Duplicate` of the
  original.
