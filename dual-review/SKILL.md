---
name: dual-review
description: Two independent code reviews — a Claude subagent and opencode running a GPT model — over a PR, a remote branch, or the current branch's diff, run concurrently and synthesised into one calibrated review, published as an artifact and optionally posted to the PR as line comments. Triggers: "dual review", "review this PR with both models", "second-opinion review", "/dual-review 123".
argument-hint: [pr-number|pr-url|branch|origin/branch] [--base <ref>] [--working-tree] [--model <provider/model>] [--claude-model opus|sonnet|haiku] [--post] [--pending] [--force]
allowed-tools: Bash(node:*), Read, Agent, Artifact, AskUserQuestion
---

# Dual review

Two reviewers see the same request independently — a Claude subagent, and opencode running a GPT model — then a fresh Claude subagent consolidates their findings into one calibrated review. The scripts in `~/.claude/skills/dual-review/scripts/` own everything deterministic: target resolution, diff annotation, the opencode process, parsing, the report page, and GitHub posting. You own orchestration and judgement. Never restate a script's mechanics; run it and act on its output.

All artifacts live in `<repo>/.dual-review/<key>/` (auto-excluded from git). Non-empty model outputs are reused on rerun; `--force` discards them. Optional per-repo defaults: `<repo>/.dual-review/config.json` with `model`, `base`, `claudeModel`.

Run from inside the repository to review. `$ARGUMENTS` is passed straight to the gather script.

## 1. Gather

```
node ~/.claude/skills/dual-review/scripts/gather.mjs $ARGUMENTS
```

It prints `meta.json`. Keep it — later steps need `cacheDir`, `reviewCwd`, `mode`, `paths`, `cached`, `post`, `pending`, `claudeModel`, `gptModel`. Do **not** read `request.md` or `diff.patch` into your own context; they can be large and they are for the reviewers.

If it fails, relay the error verbatim and stop (common causes: not a git repo, no open PR for the branch, unresolvable `--base`, `gh` not authenticated).

If `cached.synthesis` is true, tell the user you are reusing the cached synthesis and skip to step 4.

## 2. Run both reviews concurrently

Launch both **in the same message** so they overlap. Skip either whose `cached` flag is true.

**GPT review** — `Bash` with `run_in_background: true`:

```
node ~/.claude/skills/dual-review/scripts/run-opencode.mjs <cacheDir>
```

**Claude review** — `Agent` with `subagent_type: "general-purpose"`, `run_in_background: true`, and `model: <meta.claudeModel>` only when it is set. Prompt, verbatim with the paths filled in:

> You are an independent code reviewer. Your working directory for this task is `<reviewCwd>` — run every command and read every file relative to it. Read `<cacheDir>/reviewer-prompt.md` and follow it exactly; it names the request file to review. Do not modify any file in the repository. When your review is complete, write the full review Markdown to `<cacheDir>/claude.md` (create or overwrite it), then reply with only the word `done`.

Then wait for both completion notifications. Do not poll, do not predict either result, and do not start synthesis until both have finished. While waiting, if the user asks, say the reviews are still running.

When the notifications arrive:
- If `<cacheDir>/opencode.skipped.json` exists, read its `reason`, tell the user the GPT review was skipped and why, and continue Claude-only.
- If `<cacheDir>/claude.md` is missing or empty, stop and report that the Claude review failed; synthesis requires it.

## 3. Synthesise

`Agent` with `subagent_type: "general-purpose"`, foreground (`run_in_background: false`). Prompt:

> Your working directory for this task is `<reviewCwd>`. Read `<cacheDir>/synthesis-prompt.md` and follow it exactly; it lists the absolute paths of the review request and the two reviews. Write the consolidated review Markdown to `<cacheDir>/synthesis.md` (create or overwrite it), then reply with only the word `done`.

If `synthesis.md` is missing or empty afterwards, stop and report it.

## 4. Parse and render

```
node ~/.claude/skills/dual-review/scripts/findings.mjs <cacheDir>
node ~/.claude/skills/dual-review/scripts/render-report.mjs <cacheDir>
```

`findings.mjs` prints a compact summary (counts by severity and source, how many findings anchor to diff lines). `render-report.mjs` writes `report.html` and prints the artifact title and description to use.

## 5. Publish the artifact

Call `Artifact` with `file_path: <cacheDir>/report.html`, the printed `title` and `description`, and `favicon: "🔍"` on a first publish. If `<cacheDir>/artifact.json` exists, pass its `url` so the rerun updates the same page (and omit `favicon`). After publishing, record the URL:

```
node ~/.claude/skills/dual-review/scripts/render-report.mjs <cacheDir> --save-url <artifact-url>
```

The page is designed by the template; publish it as-is rather than restyling it per run.

## 6. Report to the user

In the terminal: the synthesis Summary paragraph, the severity and agreement counts, the artifact link, and the cache directory. Note any skipped reviewer. Keep it short — the artifact carries the detail.

## 7. Post to the PR (PR mode only)

Only when `meta.mode` is `"pr"` and there is at least one finding that is not already raised.

- If `meta.post` is true: post without asking. Add `--submit` unless `meta.pending` is true.
- Otherwise ask with `AskUserQuestion`: "Post N line comments and M unanchored findings to PR #n?" with options *Post and submit as a comment review* (recommended), *Post but leave the review pending*, *Skip*. Use the counts from `findings.mjs`. In a non-interactive session, skip.

```
node ~/.claude/skills/dual-review/scripts/post-review.mjs <cacheDir> [--submit]
```

Relay its posted/failed counts. The review is always a `COMMENT` review — never approve or request changes on the author's behalf. Findings already posted by an earlier run at the same line are skipped automatically.

## 8. Clean up

```
node ~/.claude/skills/dual-review/scripts/gather.mjs cleanup <cacheDir>
```

Removes the detached worktree if one was created for a PR or remote branch. Always run it, including after a failure in steps 2–7.

## Troubleshooting

- **GPT review skipped with an authentication error.** opencode reads provider keys from `{env:NAME}` placeholders in its config. When such a variable is absent from the environment, `run-opencode.mjs` runs opencode through the user's shell with `~/.zshrc` (or `~/.bashrc`) sourced so the key is inherited. If it is still missing, the export lives somewhere that shell does not source — move it to `~/.zshenv` or export it before starting Claude Code.
- **"could not resolve <branch>"** — the branch is neither local nor on `origin`; pass `origin/<name>` for another remote name, or a PR number.
- **Findings at wrong lines.** Reviewers are told to use the request's gutter numbers; a finding whose line is not part of the diff is carried in the review body instead of being posted inline, never silently dropped.
- **Stale cache.** The cache key includes the head SHA (and base SHA for branch diffs), so new commits get a fresh directory automatically; `--force` reruns the models for the same commit.
