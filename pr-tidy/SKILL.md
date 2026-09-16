---
name: pr-tidy
description: Pre-PR tidy-up of the prose in a branch's changes. Inventories the Markdown docs, code comments, doc comments, public API schema descriptions (GraphQL SDL, code-first builders, OpenAPI) and user-facing UI text that the branch added or changed, checks each against the code for accuracy, then rewrites it in plain technical English (ASD-STE100 style), removes mannered prose, and strips implementation details from public descriptions. Use before opening a PR, or when asked to "tidy the docs and comments", "remove mannered prose", "review the wording in this branch", "check the schema descriptions", or "/pr-tidy".
argument-hint: [--base <ref>] [--committed] [--whole-files] [--report-only] [-- <pathspec>...]
allowed-tools: Bash(node:*), Bash(git diff:*), Bash(git log:*), Bash(git status:*), Read, Edit, Write, Grep, Glob, Agent
---

# pr-tidy

You are the editor of a change that is about to become a pull request. The code is done. Your job is the prose the change added or touched: docs, comments, schema descriptions and UI text. You check each passage against the code, then make it accurate, clear and short, in plain technical English. You remove mannered prose: figurative language, flourish and filler that stand in for a direct statement. Comments and documentation that a reader will trust must be true, and prose that a reader has to decode costs more than it gives.

The script `~/.claude/skills/pr-tidy/scripts/gather.mjs` owns the deterministic work: base resolution, the diff, classification of prose lines, a lint for known tells, and the post-edit check. You own judgement: what a passage means, whether the code agrees, what to keep, and how to say it. Run from inside the repository.

Copy this checklist into your working notes and tick each item as you go:

```
[ ] 1 gather      [ ] 2 read references   [ ] 3 accuracy pass   [ ] 4 rewrite pass
[ ] 5 public API  [ ] 6 UI text           [ ] 7 check           [ ] 8 report
```

## 1. Gather

```
node ~/.claude/skills/pr-tidy/scripts/gather.mjs $ARGUMENTS
```

It prints a digest: scope, the branch's commits, a table of changed files with prose, and lint hit counts. It also writes `candidates.md` (every prose line with its number, kind and lint hits) and `inventory.json` to the directory it names. Keep the directory path.

Defaults: base is `origin/HEAD`, scope is committed plus staged, unstaged and untracked changes, and only added or changed lines are in scope. `--committed` limits scope to commits. `--whole-files` puts every line of each changed file in scope. `--report-only` means report findings and change nothing. Anything after `--` is a git pathspec.

If the script fails, relay its error and stop. If the digest reports zero prose lines, say so and stop.

Read the commit subjects in the digest. They tell you the intent of the change, which you need to judge whether a comment or doc is still true.

## 2. Read the references

Always read `references/style.md`. Then read the reference for each category the digest lists:

| Digest category or kind | Reference |
| --- | --- |
| `comment`, `inline comment` | `references/comments.md` |
| `doc` | `references/docs.md` |
| `schema` | `references/schema.md` |
| `ui text`, `ui text?` | `references/ui-text.md` |

Also look for a project style guide (`CLAUDE.md`, `CONTRIBUTING.md`, `docs/style*.md`, a `.vale.ini`, a Markdown formatter config). Where the project documents a convention, it wins over these references.

## 3. Accuracy pass

Work through `candidates.md` file by file, in the order given. Read the file itself around each candidate; the candidate line is a pointer, not the unit of work. The unit of work is the whole comment, description, paragraph or string.

For each passage, read the code it describes and answer: is this still true after the change? Check names, defaults, units, failure modes, ordering, nullability and every claim about behaviour. Verify against the code, not against other prose. When a passage is wrong, fix it so it matches the code, or delete it. Record every accuracy fix; the report lists them separately because they change meaning.

When a passage is right and the code is unclear, prefer the structural fix if it is small and local: a better name, a constant, a type. Otherwise keep the comment. Do not widen the change beyond the branch's files.

## 4. Rewrite pass

Apply `references/style.md` to every passage in scope. For each one, decide in this order:

1. **Delete** when the passage restates the code or signature, narrates the change's history, praises the work, or says something the reader already knows.
2. **Shorten** when it says something useful in too many words or with flourish. Say the literal thing.
3. **Keep** when it records a constraint, a non-obvious trade-off, a contract, or a workaround and its trigger. Prose that says *why* is what comments are for. Do not remove it because it is long; make it plain.

Edit prose only. Do not change identifiers, logic, string keys, schema names, types, nullability or directives. Do not reflow or reformat lines you did not edit. Keep the repository's spelling variant and its comment style (`//` versus `/** */`, wrap width). Keep line-comment wrapping consistent with the surrounding block.

The lint hits in `candidates.md` are hints. A hit means look; it does not mean change. A clean line can still be mannered, and this is the common case: figurative comments contain no listed word. Read every passage in scope, with or without hits.

A neighbouring passage outside the diff may be plainly mannered or wrong. Fix it when it is small and in the same comment block or section. Otherwise note it as a follow-up in the report.

## 5. Public API pass

Every description in a public schema is a contract with a consumer who cannot see the code. Apply `references/schema.md` to each `schema` candidate: SDL block strings, `description:` in code-first builders, `@deprecated(reason:)`, OpenAPI `summary` and `description`, and `.proto` doc comments.

Remove what a consumer cannot use or must not depend on. That includes service, table, cache, queue and resolver names, which UI screen reads the field, ticket numbers, the word "legacy", and how the value is computed. Keep what the consumer needs: meaning, units, format, what null means, ordering, limits, permissions, and the replacement for a deprecated field. Treat every schema as public unless the project says which schemas are internal.

## 6. UI text pass

Apply `references/ui-text.md` to each `ui text` candidate. `ui text?` is a weak guess; confirm the string reaches a user before you edit it. Error messages say what happened and what to do next, in the user's terms. Remove technical terms, blame, apologies and exclamation marks. Button labels are verbs. Keep placeholders, interpolation tokens and i18n keys exactly as they are.

## 7. Check

```
node ~/.claude/skills/pr-tidy/scripts/gather.mjs --check --out <dir>
```

It re-inventories, re-lints, and diffs the working tree against the snapshot from step 1. Read its three sections:

- **Changed hunks where code also changed.** Each is a possible accidental edit to code. Open each one. Revert anything that changed code; keep only deliberate string edits.
- **Remaining lint hits.** Each is a false positive or unfinished work. Fix the unfinished ones. For the rest, be able to say why in one clause.
- **Files edited.** Confirm this list matches what you intended.

Then run the project's cheap checks that cover the files you edited: a Markdown formatter (Prettier, oxfmt, dprint), a schema validator or codegen such as `npm run gql:generate`, a type check. Use the commands the project's `CLAUDE.md` or `package.json` names. Report their result. Do not skip a failing one.

Do not commit. The user reviews the diff and commits.

## 8. Report

Keep the report short. It has these parts, in this order:

1. One sentence: how many files edited, how many passages deleted, shortened or rewritten.
2. **Accuracy fixes.** Each one, as `path:line` and one sentence on what was wrong. This is the section the user reads first.
3. **Public API changes.** Each removed implementation detail, as `path:line`. Note any description you could not make consumer-safe without a decision from the user.
4. **Not changed.** Lint hits you judged false positives (one clause each), passages outside the diff you left for a follow-up, and anything you could not verify against the code.
5. The check summary: prose lines and lint hits before and after, and the result of any project checks you ran.

In `--report-only` mode, the report replaces the edits: list each proposed change as `path:line`, the current text, and the proposed text.

## Large branches

When the digest lists more than about fifteen files with prose, split the files across `general-purpose` subagents. Give each a disjoint list of files. Tell each to read `references/style.md` plus the relevant references, follow steps 3 to 6 for its files only, and reply with its accuracy fixes and unresolved items. Launch them in one message. Then run step 7 and write the report yourself. Never let two agents edit the same file.

## Troubleshooting

- **"could not determine a base branch"**: the repository has no `origin/HEAD` and `gh` cannot see it. Pass `--base origin/main` or the right ref.
- **A generated file appears in the digest.** The script skips common generated paths. Pass a pathspec that excludes it, for example `-- . ':!src/generated'`, and tell the user.
- **Line numbers in `candidates.md` drift after edits.** They are from the last gather. Re-run `--check` to refresh `candidates.md`, or read the file.
- **Test files.** UI-text guesses are suppressed in test files because their strings are fixtures. Comments in test files are still in scope.
