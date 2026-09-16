# skills

Claude Code skills. Each top-level directory is one skill; symlink it into `~/.claude/skills/` to install.

```bash
git clone https://github.com/cuzzlor/skills ~/dev/skills
mkdir -p ~/.claude/skills
ln -s ~/dev/skills/dual-review ~/.claude/skills/dual-review
ln -s ~/dev/skills/pr-tidy ~/.claude/skills/pr-tidy
```

## dual-review

`/dual-review [pr | url | branch] [--base <ref>] [--working-tree] [--model <provider/model>] [--post] [--force]`

Two independent code reviews — a Claude subagent and opencode running a GPT model — over a PR, a remote branch, or the current branch's diff, run concurrently and consolidated into one severity-calibrated review. Output is a Claude artifact; in PR mode the findings can also be posted as line comments.

Requires Node ≥ 22, `git`, an authenticated `gh`, and `opencode` with a non-Claude model available. The default GPT model is `litellm/azure/gpt-5.6-sol`; override per run with `--model` or per repo in `<repo>/.dual-review/config.json`. Review artifacts are cached in `<repo>/.dual-review/`, which the skill adds to `.git/info/exclude`.

Details, options, and troubleshooting: [dual-review/SKILL.md](dual-review/SKILL.md).

## pr-tidy

`/pr-tidy [--base <ref>] [--committed] [--whole-files] [--report-only] [-- <pathspec>...]`

Pre-PR tidy-up of the prose in a branch's changes: Markdown docs, code and doc comments, public API schema descriptions (GraphQL SDL, code-first builders, OpenAPI) and user-facing UI text. A script inventories the prose the branch added or changed and lints it for known tells; Claude then checks each passage against the code, rewrites it in plain technical English, removes mannered prose, and strips implementation details from public descriptions. Edits land in the working tree, uncommitted. A post-edit check flags any hunk where code outside strings and comments changed.

Requires Node ≥ 22 and `git`; `gh` is used only to find the default branch when `origin/HEAD` is unset. The writing rules live in [pr-tidy/references/](pr-tidy/references/): `style.md` (all prose), `comments.md`, `docs.md`, `schema.md`, `ui-text.md`.

Why a skill rather than a CLAUDE.md rule: CLAUDE.md is advisory context that competes with everything else in the session, and short style rules there are often not applied. A skill loads the full rules and examples at the moment they are used, and the script gives a checklist to work through and a check to run afterwards. A one-line CLAUDE.md rule such as "Before opening a PR, run /pr-tidy" is enough to connect the two.

Details: [pr-tidy/SKILL.md](pr-tidy/SKILL.md).

## License

[MIT](LICENSE)
