# skills

Claude Code skills. Each top-level directory is one skill; symlink it into `~/.claude/skills/` to install.

```bash
git clone https://github.com/cuzzlor/skills ~/dev/skills
mkdir -p ~/.claude/skills
ln -s ~/dev/skills/dual-review ~/.claude/skills/dual-review
ln -s ~/dev/skills/pr-tidy ~/.claude/skills/pr-tidy
```

## dual-review

`/dual-review [pr | url | branch] [--base <ref>] [--working-tree] [--model <provider/model>] [--backend opencode|litellm] [--post] [--force]`

Two independent code reviews — a Claude subagent and a GPT model — over a PR, a remote branch, or the current branch's diff, run concurrently and consolidated into one severity-calibrated review. Output is a Claude artifact; in PR mode the findings can also be posted as line comments.

Requires Node ≥ 22, `git` and an authenticated `gh`. The GitHub calls use the REST API only. The GPT review has two backends:

- `opencode`: runs the opencode CLI with a non-Claude model. The skill uses it when `opencode` is on `PATH`.
- `litellm`: calls a LiteLLM proxy through its OpenAI-compatible API and gives the model read-only tools to read and search the checkout. The skill uses it when opencode is not installed and `LITELLM_BASE_URL` is set. Set `LITELLM_API_KEY` too, unless a cloud network secret supplies the key.

`--backend` or `"backend"` in the config file overrides the choice. The default GPT model is `litellm/azure/gpt-6.1-sol`; override per run with `--model` or per repo in `<repo>/.dual-review/config.json`. The `litellm` backend removes the `litellm/` prefix and sends `azure/gpt-6.1-sol`. Review artifacts are cached in `<repo>/.dual-review/`, which the skill adds to `.git/info/exclude`.

Details, options, and troubleshooting: [dual-review/SKILL.md](dual-review/SKILL.md).

## pr-tidy

`/pr-tidy [--base <ref>] [--committed] [--whole-files] [--all] [--report-only] [-- <pathspec>...]`

Tidy-up of the prose in a branch's changes, or in any set of files chosen by git pathspec: Markdown docs, code and doc comments, public API schema descriptions (GraphQL SDL, code-first builders, OpenAPI) and user-facing UI text. A script inventories the prose in scope and lints it for known tells; Claude then checks each passage against the code, rewrites it in plain technical English, removes mannered prose, and strips implementation details from public descriptions. Edits land in the working tree, uncommitted. A post-edit check flags any hunk where code outside strings and comments changed.

By default the scope is the branch's diff. `--all -- '*schema.graphql' ':!api/src/schema'` ignores the diff and takes every matching file whole; natural requests such as "tidy all the schema files except the ones in api/src/schema" map to that form.

Requires Node ≥ 22 and `git`; `gh` is used only to find the default branch when `origin/HEAD` is unset. The writing rules live in [pr-tidy/references/](pr-tidy/references/): `style.md` (all prose), `comments.md`, `docs.md`, `schema.md`, `ui-text.md`.

Why a skill rather than a CLAUDE.md rule: CLAUDE.md is advisory context that competes with everything else in the session, and short style rules there are often not applied. A skill loads the full rules and examples at the moment they are used, and the script gives a checklist to work through and a check to run afterwards. A one-line CLAUDE.md rule such as "Before opening a PR, run /pr-tidy" is enough to connect the two.

Details: [pr-tidy/SKILL.md](pr-tidy/SKILL.md).

## Claude Code cloud sessions

A cloud session does not read `~/.claude/skills/` on your machine. Both skills find their scripts through `${CLAUDE_SKILL_DIR}`, so they work from any skills directory.

### Install the skills

Use one of these:

- **Setup script.** Edit the cloud environment (the environment menu in the session's title bar, then Edit) and add this setup script. It runs before Claude Code starts, and the environment cache keeps the result. The cache refreshes when you change the script or after about seven days; to get a newer version in a running session, run `git -C /opt/cuzzlor-skills pull`.

  ```bash
  #!/bin/bash
  git clone --depth 1 https://github.com/cuzzlor/skills /opt/cuzzlor-skills || true
  mkdir -p ~/.claude/skills
  ln -sfn /opt/cuzzlor-skills/dual-review ~/.claude/skills/dual-review
  ln -sfn /opt/cuzzlor-skills/pr-tidy ~/.claude/skills/pr-tidy
  ```

- **claude.ai skills.** Upload each skill folder as a zip in the skills settings on claude.ai. Cloud sessions sync the skills that are on for your account. An upload accepts only the `name`, `description`, `license`, `compatibility`, `metadata` and `allowed-tools` frontmatter fields, so remove the `argument-hint` line from the copy that you upload.

### Configure LiteLLM for dual-review

opencode is not installed in a cloud session, so dual-review uses the `litellm` backend.

1. Under **Environment variables**, add `LITELLM_BASE_URL=https://<your LiteLLM host>`.
2. Give the session the key. Use one of these:
   - A **network secret** for the LiteLLM host, with the `Authorization` header and the `Bearer` prefix. The agent proxy adds the key to each request, and the session cannot read it. A network secret also allows the host through the network policy. Do not set `LITELLM_API_KEY`.
   - `LITELLM_API_KEY=<key>` under **Environment variables**. Each person who uses the environment can read it. Then add the LiteLLM host under **Network access** → Allowed domains, with the default list of package managers kept.
3. Start a new session. Sessions read the environment when they start.

The PR must be in a repository attached to the session. The cloud proxy blocks GitHub GraphQL, which the `gh pr` subcommands use, so the scripts use `gh api` REST calls.

## License

[MIT](LICENSE)
