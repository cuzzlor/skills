# skills

Claude Code skills. Each top-level directory is one skill; symlink it into `~/.claude/skills/` to install.

```bash
git clone https://github.com/cuzzlor/skills ~/dev/skills
mkdir -p ~/.claude/skills
ln -s ~/dev/skills/dual-review ~/.claude/skills/dual-review
```

## dual-review

`/dual-review [pr | url | branch] [--base <ref>] [--working-tree] [--model <provider/model>] [--post] [--force]`

Two independent code reviews — a Claude subagent and opencode running a GPT model — over a PR, a remote branch, or the current branch's diff, run concurrently and consolidated into one severity-calibrated review. Output is a Claude artifact; in PR mode the findings can also be posted as line comments.

Requires Node ≥ 22, `git`, an authenticated `gh`, and `opencode` with a non-Claude model available. The default GPT model is `litellm/azure/gpt-5.6-sol`; override per run with `--model` or per repo in `<repo>/.dual-review/config.json`. Review artifacts are cached in `<repo>/.dual-review/`, which the skill adds to `.git/info/exclude`.

Details, options, and troubleshooting: [dual-review/SKILL.md](dual-review/SKILL.md).

## License

[MIT](LICENSE)
