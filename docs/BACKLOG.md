# Backlog

Ideas that are out of scope for the work in flight but should not evaporate.
Nothing here is committed to; each needs its own discussion before it becomes a
plan.

## Giving the review agent context the diff does not carry

The reviewer currently sees the PR diff and the PR description, and nothing
else. That envelope is a deliberate architectural choice — see "Why not just
read the repo" below — but it is the binding constraint on review quality,
and it bites hardest on exactly the changes where a good review matters most:
large refactors, anything whose rationale lives outside the changed files, and
architecture diagrams, which by their nature describe things the diff only
touches the edges of.

Three approaches, roughly in order of how cheap they are to try.

### 1. An optional context box when a review is created

A free-text field on the composer where the author or reviewer can paste
whatever context they have — design notes, a linked discussion, a voice-to-text
ramble, output from something else. Fed to the prompt alongside the PR
description.

Cheapest of the three by a wide margin: one column, one textarea, one prompt
section. No new permissions, no new infrastructure. It also makes the other two
approaches useful without further work, because both of them ultimately produce
text that has to arrive somewhere.

### 2. A context-gathering skill run in the user's own repository

A shareable skill that the user drops into a repo they already have checked
out, and hands to an agent running there. Given a PR, it gathers the context
the diff cannot carry — the surrounding architecture, prior art for the pattern
being changed, related modules the PR does not touch, conventions the change is
or is not following — and emits it as structured metadata.

It performs none of the review preparation this application does; it only
produces context, which the user then pastes into (1).

The appeal is that it inverts the hard part. The repository, the checkout and
the permissions already exist on the user's machine; nothing has to be granted
to, cloned by, or stored in this application. It is the cheapest route to
genuine repository awareness precisely because it does not try to make this
application repository-aware.

Open questions: what shape the metadata takes (a schema shared with the
narrative prompt, or free text), how it stays current as the PR moves, and
whether the skill's output should be trusted as authored context or treated as
another untrusted input.

### 3. Full repository context inside the application

The version everyone reaches for first: clone the repo, hand the agent
read-only tools, let it explore.

Why not, for now: the review runner lives in-process in a single web server.
Doing this properly needs broader GitHub permissions, ephemeral storage for the
clone, and concurrency handling across simultaneous reviews — that is an
ephemeral-task architecture (a one-off container per review), not a web server.
The added operational surface is not worth it at this stage, and (2) gets most
of the benefit for none of it.

Revisit if and when the deployment story changes.
