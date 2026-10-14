---
name: looped-review
description: Run /code-review, apply fixes for its findings in a subagent, then re-review — repeating until no medium+ severity issues remain or a round cap is hit. Use when the user wants a hands-off review-and-fix cycle ("review and fix this", "loop the review until it's clean") instead of a single review pass they'd have to act on manually.
disable-model-invocation: false
---

# Looped review

Runs `/code-review`, hands its findings to a fresh subagent to fix, then re-reviews the result — repeating until the review comes back clean (no findings at or above the severity floor) or a round cap is reached.

## Arguments

Same target as `/code-review` (PR URL, diff, branch, or path), plus two optional overrides:

- `--max-loops=N` — round cap. Default **3**.
- `--min-severity=medium|high|critical` — floor for what counts as an open issue. Default **medium** (i.e. stop looping once nothing medium-or-higher remains; low-priority nitpicks don't block convergence).

A review effort level (low/medium/high/xhigh/max), if given, is passed straight through to `/code-review` on every round.

Do not pass `--fix` or `--comment` through to `/code-review` — this skill owns fixing (via a subagent, not `/code-review`'s own `--fix`) and should not post PR comments mid-loop.

## Never self-schedule

Do **not** use `/loop`, `ScheduleWakeup`, or `CronCreate` to drive this. The round cap below is the only looping construct. When a review or fix subagent is running, simply wait — its completion notification arrives on its own. Scheduling a wakeup that re-fires the `/looped-review` prompt restarts the whole skill and silently blows past `--max-loops`, which is never wanted.

Never start a new round after the cap. If the user wants more, they will ask.

## Setup (once, before round 1)

This exists because a loop that only ever sees a diff will "fix" correct code. Do this yourself — do not delegate it.

1. **Pin the diff target.** Resolve it once to an explicit, stable ref and reuse that exact ref every round. For a branch, use the merge base (`git merge-base origin/main HEAD`), not `origin/main` — a branch behind main produces a diff full of unrelated reverted changes that will derail every reviewer. Include uncommitted working-tree changes.
2. **Establish intent.** Read the commit messages on the branch and the PR description if there is one. Write down, in two or three sentences, what this change is supposed to do and what it explicitly promises _not_ to change.
3. **Establish the baseline.** For the main files being changed, look at what the code did before (`git show <merge-base>:<path>`). You are checking behaviour against a known-good reference, not against taste.

Carry the intent and baseline summary into **every** reviewer and fixer prompt for the rest of the loop. Findings that contradict the documented intent are usually wrong about the intent.

## Loop

Track a round counter starting at 1, the previous round's qualifying findings (starts empty), and the set of files each fix subagent has touched (starts empty).

1. **Review.** Invoke `/code-review <pinned target> [level]` via the Skill tool. Do not add `--fix` or `--comment`. Include in the prompt: the intent and baseline summary from Setup, and — from round 2 on — which files previous fix rounds edited, noting those edits are unreviewed loop output rather than the author's work.
2. **Filter.** Take the findings at or above `--min-severity`. Ignore anything below the floor — nitpicks never block convergence and are never handed to the fix subagent.
3. **Sanity-check each finding against the baseline.** Before accepting a finding that says existing behaviour is wrong, confirm the behaviour actually changed, by checking the baseline. If the code matches the baseline and the intent says that area should be unchanged, the finding is wrong — drop it and say so in the report. **A finding is a hypothesis, not an instruction.** Passing an incorrect finding to a fixer is how a loop breaks working code and then spends later rounds chasing the damage.
4. **Converged?** If there are zero qualifying findings, stop. Report the round count and that the review is clean.
5. **Thrashing?** If any qualifying finding points at a file a previous round's fixer edited, the loop is now reviewing its own output. Stop and surface those findings instead of fixing them. Also stop if this round's qualifying set is identical to the previous round's — the last fix attempt moved nothing, and retrying it will not help.
6. **Round cap?** If this round equals `--max-loops`, stop without dispatching another fix. A fix applied on the final round is never re-reviewed, so it would ship unverified.
7. **Fix.** Otherwise spawn one `general-purpose` subagent (not a fork — it should not inherit this conversation's framing). See below for what it gets.
8. Increment the round counter, record the files the fixer reported touching, save this round's qualifying findings as "previous", and go back to step 1.

## The fix subagent

Give it:

- The intent and baseline summary from Setup.
- The qualifying findings: file, line, summary, and why each was flagged.
- The instructions below, verbatim in substance.

Do not hand it the rest of the conversation or your own theory of how to fix things — let it work from the findings. But do require it to understand before it edits:

- **Understand the invariant before changing it.** For each finding, work out what the code is supposed to guarantee and check what it did before the change. If a finding turns out to be wrong — the current behaviour is correct — do not "fix" it. Report back that it was rejected, and why.
- **Audit every other consumer.** When changing how a field, function or type is used, grep for every other use of it and check them all against the same rule. Fixing the one call site named in a finding, while its siblings stay inconsistent, is what makes these loops run forever.
- **Change nothing that was not flagged.** No adjacent cleanup, no renames, no "while I'm here" improvements, and nothing below the severity floor.
- **Pin the behaviour with a test.** Any behavioural fix needs a test that fails before it and passes after. If a bug reached the code because nothing tested the invariant, the test is the more important half of the fix.
- **Verify.** Run the tests for what was touched, plus lint and typecheck. Report exactly what was run.
- Report which files were edited, which findings were fixed, and which were rejected.

## Report

At the end (converged, thrashing, or round cap hit) summarize: how many rounds ran, what was fixed each round, any findings rejected as incorrect and why, and — if stopping non-clean — the exact remaining findings so the user can take it from there.

If the loop spent more than one round in the same area, say so plainly and recommend a single scoped read-through of that area instead of another loop. Repeated findings in one place mean the model of that code is wrong, and more rounds will not fix that.
