You are consolidating two independent code reviews of the same change into one calibrated review. The review request and both reviews are at the absolute paths listed at the end of this prompt. Read them from those paths — your working directory is the repository under review, not the directory holding those files.

If no file exists at the GPT review path, the GPT reviewer was skipped. Work from the Claude review alone: tag every finding `claude-only`, mark nothing `confirmed` or `gpt-only`, and note in the Summary that the GPT reviewer was skipped.

Read the request and every available review, deduplicate the findings, recalibrate their severity, and write a single consolidated review in Markdown with exactly this structure:

# Code review synthesis

## Summary

Two or three sentences on the change's overall quality and the most important risks. Mention where the reviewers disagreed if they did.

## Findings

One block per finding, in exactly this format:

### Finding: <short title>
- Severity: blocker | major | minor | nit
- Source: confirmed | disputed | claude-only | gpt-only | already-raised
- Location: `path/to/file.ext:LINE`, `path/to/file.ext:START-END`, or `n/a` when not tied to a line
- Impact: one sentence on what could go wrong and when
- Recommendation: one or two sentences with a concrete change

If there are no findings, write `No findings.` under the heading.

## Severity rubric

Recalibrate every finding against this — reviewers tend to inflate:

- **blocker** — ships broken behaviour: crash, data loss, security hole, breaks the build or existing tests, or violates a stated requirement.
- **major** — likely bug, missing error handling on a real failure mode, or a regression in existing behaviour. Not "this could be cleaner" or "this might be slow".
- **minor** — narrow correctness or clarity issue with limited blast radius; worth fixing but not urgent.
- **nit** — style, naming, micro-refactors, wording; a reviewer would not block on it.

Default to the lower tier when uncertain. If a reviewer marked something major but the impact reads as taste or hypothetical, downgrade it. A finding is only major or above if a concrete failure mode or regression is named.

## Rules

- `confirmed` — both reviewers raised the same underlying issue, even if worded differently.
- `disputed` — the reviewers disagreed on the diagnosis or the fix. Describe both positions briefly in Impact.
- `claude-only` / `gpt-only` — only one reviewer raised it. Keep it if it clears the bar on its own merits; drop it if it fails the rubric.
- `already-raised` — a prior review comment in the request (under "Prior review comments") substantively covers this finding: same file, same defect or recommendation. Use this even when the prior thread is resolved or outdated. Cosmetic overlap is not enough. Prefer `already-raised` over the other sources when it applies.
- Drop findings that contradict conventions documented in the repository (`CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, or similar) — check those files when a finding is about style or structure.
- Drop findings that are not introduced by this change, or that rest on speculation without a named code path.
- Documentation and comment findings are kept, not dismissed as style. Accuracy findings (text contradicts the code) take precedence over wording findings and are minor by default, major when following the text would produce broken behaviour. Merge several verbosity findings about the same file or section into one finding that names the passages and says what to cut; its severity is nit, or minor when the padding materially impedes understanding. A finding whose recommendation is to add explanatory prose is dropped unless it corrects an inaccuracy or the repository's conventions require the documentation.
- Order findings by severity (blocker, major, minor, nit), then by source (confirmed first).
- Take line numbers from the reviews; when they disagree, check the request's gutter numbers. If a finding has no specific location, set Location to `n/a` exactly.
- Do not invent findings beyond what the reviews support.

Output only the consolidated Markdown. No preamble, no commentary about your process.
