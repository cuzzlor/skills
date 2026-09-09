#!/usr/bin/env node
// dual-review — resolve what to review and write the request into the repo-local cache.
//
//   gather.mjs [target] [--base <ref>] [--working-tree] [--model <id>] [--claude-model <name>]
//              [--post] [--pending] [--force]
//   gather.mjs cleanup <cacheDir>

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIRNAME = ".dual-review";
const DEFAULT_GPT_MODEL = "litellm/azure/gpt-5.6-sol";
const MAX_BUFFER = 256 * 1024 * 1024;
const MODEL_ARTIFACTS = [
  "claude.md",
  "opencode.md",
  "opencode.skipped.json",
  "opencode.usage.json",
  "opencode.log",
  "synthesis.md",
  "findings.json",
  "report.html",
  "post-result.json",
];

const HELP = `dual-review gather — resolve the review target and write the review request.

Usage:
  gather.mjs [target] [options]
  gather.mjs cleanup <cacheDir>

Target:
  (none)                  current branch: its open PR if one exists, else the diff against the base
  123 | #123 | <PR URL>   a pull request
  feature | origin/feature  a branch (fetched if needed); upgraded to PR mode if it has an open PR

Options:
  --base <ref>            base for branch/local diffs (default: config "base", else origin/HEAD)
  --working-tree          review uncommitted changes too (current branch only; untracked files included)
  --model <id>            opencode model for the GPT review (default: config "model", else ${DEFAULT_GPT_MODEL})
  --claude-model <name>   subagent model for the Claude review: opus | sonnet | haiku (default: inherit)
  --post                  post to the PR without asking; --pending leaves the review unsubmitted
  --force                 discard cached model outputs for this target

Per-repo defaults: <repo>/${CACHE_DIRNAME}/config.json { "model", "base", "claudeModel" }
`;

function fail(message) {
  console.error(`dual-review: ${message}`);
  process.exit(1);
}

function run(cmd, args, { cwd, input, allowFail = false } = {}) {
  try {
    return execFileSync(cmd, args, {
      cwd,
      input,
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    }).replace(/\s+$/, "");
  } catch (error) {
    if (allowFail) return null;
    const stderr = String(error.stderr ?? "").trim();
    throw new Error(`\`${cmd} ${args.join(" ")}\` failed${stderr ? `:\n${stderr}` : ""}`);
  }
}

const git = (args, cwd, opts = {}) => run("git", args, { cwd, ...opts });
const gh = (args, cwd, opts = {}) => run("gh", args, { cwd, ...opts });

function ghJson(args, cwd) {
  const out = gh(args, cwd, { allowFail: true });
  if (out === null || !out.trim()) return null;
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function nonEmpty(file) {
  try {
    return fs.statSync(file).size > 0;
  } catch {
    return false;
  }
}

function warn(message) {
  console.error(`dual-review: ${message}`);
}

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const options = {
    target: null,
    base: null,
    workingTree: false,
    model: null,
    claudeModel: null,
    post: false,
    pending: false,
    force: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    let arg = argv[i];
    let inlineValue;
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    if (eq > 0) {
      inlineValue = arg.slice(eq + 1);
      arg = arg.slice(0, eq);
    }
    const value = () => {
      if (inlineValue !== undefined) return inlineValue;
      const next = argv[++i];
      if (next === undefined) fail(`${arg} requires a value`);
      return next;
    };
    switch (arg) {
      case "--base":
        options.base = value();
        break;
      case "--working-tree":
      case "--wt":
        options.workingTree = true;
        break;
      case "--model":
        options.model = value();
        break;
      case "--claude-model":
        options.claudeModel = value();
        break;
      case "--post":
        options.post = true;
        break;
      case "--pending":
        options.pending = true;
        break;
      case "--force":
        options.force = true;
        break;
      case "-h":
      case "--help":
        options.help = true;
        break;
      default:
        if (arg.startsWith("-")) fail(`unknown option ${arg}\n\n${HELP}`);
        if (options.target) fail(`unexpected extra argument ${arg}`);
        options.target = arg;
    }
  }
  return options;
}

function parseTarget(target) {
  if (!target) return { kind: "current" };
  let match = target.match(/^#?(\d+)$/);
  if (match) return { kind: "pr", number: Number(match[1]) };
  match = target.match(/github\.com\/([^/]+\/[^/#?]+)\/pull\/(\d+)/);
  if (match) return { kind: "pr", number: Number(match[2]), repo: match[1] };
  return { kind: "ref", ref: target };
}

// ---------------------------------------------------------------- diff helpers

const FILE_HEADER = /^\+\+\+ (?:b\/)?(.+)$/;
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const GUTTER_WIDTH = 6;

function gutter(lineNumber) {
  const label = lineNumber === null ? "" : String(lineNumber);
  return `${label.padStart(GUTTER_WIDTH, " ")}  `;
}

function annotateDiff(diff) {
  let inFile = false;
  let newLine = 0;
  return diff
    .split("\n")
    .map((line) => {
      if (FILE_HEADER.test(line)) {
        inFile = true;
        return gutter(null) + line;
      }
      const hunk = line.match(HUNK_HEADER);
      if (hunk) {
        newLine = Number(hunk[1]);
        return gutter(null) + line;
      }
      if (!inFile) return gutter(null) + line;
      if (line.startsWith("+") || line.startsWith(" ")) {
        const annotated = gutter(newLine) + line;
        newLine += 1;
        return annotated;
      }
      return gutter(null) + line;
    })
    .join("\n");
}

function changedFilesFromDiff(diff) {
  const files = new Set();
  for (const line of diff.split("\n")) {
    const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (match) files.add(match[2]);
  }
  return [...files];
}

function untrackedFileDiff(file, cwd) {
  try {
    return execFileSync("git", ["diff", "--no-index", "--", "/dev/null", file], {
      cwd,
      encoding: "utf8",
      maxBuffer: MAX_BUFFER,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    return typeof error.stdout === "string" ? error.stdout : "";
  }
}

// ---------------------------------------------------------------- prior comments (PR mode)

function reviewThreads(repo, prNumber, cwd) {
  const threads = { threadIds: new Map(), resolved: new Set() };
  const [owner = "", name = ""] = repo.split("/");
  const query =
    "query($owner: String!, $repo: String!, $prNumber: Int!) { repository(owner: $owner, name: $repo) { pullRequest(number: $prNumber) { reviewThreads(first: 100) { nodes { id isResolved comments(first: 100) { nodes { databaseId } } } } } } }";
  const response = ghJson(
    [
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      "-F",
      `owner=${owner}`,
      "-F",
      `repo=${name}`,
      "-F",
      `prNumber=${prNumber}`,
    ],
    cwd,
  );
  if (!response || response.errors?.length) {
    warn("review threads unavailable; prior comments will not be marked resolved.");
    return threads;
  }
  for (const thread of response.data?.repository?.pullRequest?.reviewThreads?.nodes ?? []) {
    if (thread.isResolved) threads.resolved.add(thread.id);
    for (const comment of thread.comments?.nodes ?? []) {
      threads.threadIds.set(comment.databaseId, thread.id);
    }
  }
  return threads;
}

function priorComments(repo, prNumber, cwd) {
  const raw = ghJson(
    ["api", `repos/${repo}/pulls/${prNumber}/comments`, "--paginate", "--slurp"],
    cwd,
  );
  if (raw === null) {
    warn("prior review comments unavailable; the review may re-raise findings already on the PR.");
    return [];
  }
  const threads = reviewThreads(repo, prNumber, cwd);
  const comments = Array.isArray(raw) ? raw.flatMap((page) => (Array.isArray(page) ? page : [page])) : [];
  return comments.map((comment) => {
    const threadId = threads.threadIds.get(comment.id) ?? "";
    return {
      id: comment.id,
      threadId,
      file: comment.path,
      line: comment.line ?? comment.original_line ?? null,
      author: comment.user?.login ?? "unknown",
      body: comment.body ?? "",
      inReplyToId: comment.in_reply_to_id ?? null,
      resolved: threads.resolved.has(threadId),
      outdated: comment.position === null,
    };
  });
}

function formatPriorComments(comments) {
  if (comments.length === 0) return "";
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  const threads = new Map();
  for (const comment of comments) {
    const parent = comment.inReplyToId === null ? undefined : byId.get(comment.inReplyToId);
    const key = comment.threadId || `root-${parent?.id ?? comment.id}`;
    const existing = threads.get(key);
    if (existing && parent) existing.replies.push(comment);
    else if (!existing && parent) threads.set(key, { root: parent, replies: [comment] });
    else if (!existing) threads.set(key, { root: comment, replies: [] });
  }
  const blocks = [...threads.values()].map(({ root, replies }) => {
    const location = root.line === null ? root.file : `${root.file}:${root.line}`;
    const tags = [root.resolved ? "resolved" : "", root.outdated ? "outdated" : ""].filter(Boolean);
    const heading = tags.length ? `### ${location} [${tags.join(", ")}]` : `### ${location}`;
    const replyLines = replies.map((reply) => `**${reply.author}** (reply): ${reply.body.trim()}`);
    return [heading, `**${root.author}**: ${root.body.trim()}`, ...replyLines].join("\n\n");
  });
  return `## Prior review comments

The PR already has the review comments below, including resolved and outdated threads. Avoid re-raising findings that a prior comment substantively covers.

${blocks.join("\n\n")}`;
}

// ---------------------------------------------------------------- request document

function buildRequest(context) {
  const files = context.changedFiles.map((file) => `- ${file}`).join("\n") || "(none)";
  const prior = formatPriorComments(context.priorComments);
  const header =
    context.mode === "pr"
      ? [
          `- PR: #${context.prNumber} — ${context.prUrl}`,
          `- Head: \`${context.headRef}\` @ \`${context.headSha}\``,
          `- Base: \`${context.baseRef}\` @ \`${context.baseSha}\``,
        ]
      : [
          `- ${context.mode === "working-tree" ? "Working tree" : "Branch"}: \`${context.headRef}\`${
            context.mode === "working-tree" ? " (includes uncommitted changes)" : ` @ \`${context.headSha}\``
          }`,
          `- Base: \`${context.baseRef}\` @ \`${context.baseSha}\``,
          `- Merge base: \`${context.mergeBase}\``,
        ];
  const description = context.description ? `\n## Description\n\n${context.description}\n` : "";
  const priorBlock = prior ? `\n${prior}\n` : "";
  const diffLabel =
    context.mode === "pr" ? `PR #${context.prNumber}` : `${context.baseRef}...${context.headRef}`;
  return `# Code review request

${header.join("\n")}
${description}
## Changed files

${files}
${priorBlock}
## Diff (${diffLabel})

Each added or context line is prefixed with a left gutter showing its line number in the new file. When citing a finding as \`file:line\`, use that gutter number — do **not** count lines in this document. Removed lines and headers have a blank gutter and cannot be used as finding locations.

\`\`\`diff
${annotateDiff(context.diff.trimEnd())}
\`\`\`
`;
}

// ---------------------------------------------------------------- resolution

function repoInfo() {
  const repoRoot = git(["rev-parse", "--show-toplevel"], process.cwd(), { allowFail: true });
  if (!repoRoot) fail("not inside a git repository.");
  const commonDir = path.resolve(repoRoot, git(["rev-parse", "--git-common-dir"], repoRoot));
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], repoRoot);
  const head = git(["rev-parse", "HEAD"], repoRoot);
  const repo = gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], repoRoot, {
    allowFail: true,
  });
  return { repoRoot, commonDir, branch, head, repo: repo || null };
}

function resolvesTo(ref, cwd) {
  return git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], cwd, { allowFail: true });
}

function defaultBase(info) {
  const symbolic = git(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], info.repoRoot, {
    allowFail: true,
  });
  if (symbolic) return symbolic;
  const remoteDefault = gh(
    ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"],
    info.repoRoot,
    { allowFail: true },
  );
  if (remoteDefault) {
    if (resolvesTo(`origin/${remoteDefault}`, info.repoRoot)) return `origin/${remoteDefault}`;
    if (resolvesTo(remoteDefault, info.repoRoot)) return remoteDefault;
  }
  for (const candidate of ["origin/main", "main", "origin/master", "master"]) {
    if (resolvesTo(candidate, info.repoRoot)) return candidate;
  }
  return fail("could not determine a base branch; pass --base <ref>.");
}

function openPrForBranch(branchName, info) {
  if (!info.repo) return null;
  const prs = ghJson(
    ["pr", "list", "--state", "open", "--head", branchName, "--limit", "1", "--json", "number"],
    info.repoRoot,
  );
  return prs?.[0]?.number ?? null;
}

function fetchBranch(remote, name, cwd) {
  // Explicit refspec so single-branch (shallow) clones still get refs/remotes/<remote>/<name>.
  git(["fetch", "--quiet", remote, `+refs/heads/${name}:refs/remotes/${remote}/${name}`], cwd, {
    allowFail: true,
  });
}

function resolveRef(ref, info) {
  const cwd = info.repoRoot;
  const remotes = git(["remote"], cwd, { allowFail: true })?.split("\n").filter(Boolean) ?? [];
  const remoteMatch = ref.match(/^([^/]+)\/(.+)$/);
  if (remoteMatch && remotes.includes(remoteMatch[1])) {
    fetchBranch(remoteMatch[1], remoteMatch[2], cwd);
    const sha = resolvesTo(ref, cwd);
    if (!sha) fail(`could not resolve ${ref}.`);
    return { sha, branchName: remoteMatch[2], label: ref };
  }
  const local = resolvesTo(ref, cwd);
  if (local) return { sha: local, branchName: ref, label: ref };
  if (remotes.includes("origin")) {
    fetchBranch("origin", ref, cwd);
    const remote = resolvesTo(`origin/${ref}`, cwd);
    if (remote) return { sha: remote, branchName: ref, label: `origin/${ref}` };
  }
  return fail(`could not resolve ${ref} locally or on origin.`);
}

function gatherPr(number, info, repoOverride) {
  const cwd = info.repoRoot;
  const repoArgs = repoOverride ? ["-R", repoOverride] : [];
  const pr = ghJson(
    [
      "pr",
      "view",
      String(number),
      ...repoArgs,
      "--json",
      "number,title,body,url,baseRefName,baseRefOid,headRefName,headRefOid,isCrossRepository",
    ],
    cwd,
  );
  if (!pr) fail(`could not load PR #${number}. Is gh authenticated and does this repository have a GitHub remote?`);
  const repo = repoOverride ?? info.repo ?? pr.url.match(/github\.com\/([^/]+\/[^/]+)\/pull/)?.[1];
  git(["fetch", "--quiet", "origin", `+refs/pull/${number}/head:refs/dual-review/pr-${number}`], cwd, {
    allowFail: true,
  });
  git(["fetch", "--quiet", "origin", pr.baseRefName], cwd, { allowFail: true });
  let diff;
  try {
    diff = gh(["pr", "diff", String(number), ...repoArgs], cwd);
  } catch (error) {
    const detail = String(error.message);
    if (!/too_large|maximum number of files/i.test(detail)) throw error;
    warn("gh pr diff refused the diff as too large; using git diff instead.");
    diff = git(["diff", `${pr.baseRefOid}...${pr.headRefOid}`], cwd);
  }
  const body = (pr.body ?? "").trim();
  return {
    mode: "pr",
    repo,
    prNumber: pr.number,
    prUrl: pr.url,
    prTitle: pr.title,
    headRef: pr.headRefName,
    headSha: pr.headRefOid,
    baseRef: pr.baseRefName,
    baseSha: pr.baseRefOid,
    mergeBase: null,
    description: `**${pr.title}**${
      body ? `\n\n${body.split("\n").map((line) => `> ${line}`).join("\n")}` : ""
    }`,
    diff,
    changedFiles: changedFilesFromDiff(diff),
    priorComments: repo ? priorComments(repo, pr.number, cwd) : [],
    headAvailable: resolvesTo(pr.headRefOid, cwd) !== null,
  };
}

function gatherBranch({ headSha, headRef, workingTree }, options, config, info) {
  const cwd = info.repoRoot;
  const baseRef = options.base ?? config?.base ?? defaultBase(info);
  const baseSha = resolvesTo(baseRef, cwd);
  if (!baseSha) fail(`base ref ${baseRef} does not resolve to a commit.`);
  const mergeBase = git(["merge-base", baseSha, headSha], cwd, { allowFail: true });
  if (!mergeBase) fail(`no merge base between ${baseRef} and ${headRef}.`);
  let diff = workingTree ? git(["diff", mergeBase], cwd) : git(["diff", mergeBase, headSha], cwd);
  if (workingTree) {
    const untracked = git(["ls-files", "--others", "--exclude-standard"], cwd).split("\n").filter(Boolean);
    for (const file of untracked) diff += `\n${untrackedFileDiff(file, cwd).trimEnd()}`;
    diff = diff.trim();
  }
  const subjects = git(["log", "--format=%s", `${mergeBase}..${headSha}`], cwd);
  const commits = subjects ? subjects.split("\n").map((s) => `- ${s}`).join("\n") : "";
  const description = [
    commits ? `Commits since \`${baseRef}\`:\n\n${commits}` : "",
    workingTree ? "Includes uncommitted working-tree changes (staged, unstaged, and untracked files)." : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    mode: workingTree ? "working-tree" : headSha === info.head ? "local" : "branch",
    repo: info.repo,
    prNumber: null,
    prUrl: null,
    prTitle: null,
    headRef,
    headSha,
    baseRef,
    baseSha,
    mergeBase,
    description,
    diff,
    changedFiles: changedFilesFromDiff(diff),
    priorComments: [],
    headAvailable: true,
  };
}

function resolveContext(options, config, info) {
  const target = parseTarget(options.target);
  if (options.workingTree && target.kind !== "current") fail("--working-tree only applies to the current branch.");
  if (target.kind === "pr") return gatherPr(target.number, info, target.repo);
  if (target.kind === "ref") {
    if (target.ref === info.branch) return resolveContext({ ...options, target: null }, config, info);
    const resolved = resolveRef(target.ref, info);
    const prNumber = openPrForBranch(resolved.branchName, info);
    if (prNumber) return gatherPr(prNumber, info);
    return gatherBranch({ headSha: resolved.sha, headRef: resolved.label, workingTree: false }, options, config, info);
  }
  if (!options.workingTree && info.branch !== "HEAD") {
    const prNumber = openPrForBranch(info.branch, info);
    if (prNumber) return gatherPr(prNumber, info);
  }
  return gatherBranch(
    { headSha: info.head, headRef: info.branch, workingTree: options.workingTree },
    options,
    config,
    info,
  );
}

// ---------------------------------------------------------------- cache, worktree, exclude

const safe = (value) => value.replaceAll("/", "--").replace(/[^A-Za-z0-9._-]/g, "_");

function cacheKey(context) {
  const head7 = context.headSha.slice(0, 7);
  if (context.mode === "pr") return `pr-${context.prNumber}-${head7}`;
  if (context.mode === "working-tree") {
    const hash = createHash("sha256").update(context.diff).digest("hex").slice(0, 8);
    return `${safe(context.headRef)}-wt-${hash}`;
  }
  return `${safe(context.headRef)}-${head7}-from-${safe(context.baseRef)}-${context.baseSha.slice(0, 7)}`;
}

function ensureExcluded(info) {
  const excludeFile = path.join(info.commonDir, "info", "exclude");
  let current = "";
  try {
    current = fs.readFileSync(excludeFile, "utf8");
  } catch {}
  const lines = current.split("\n").map((line) => line.trim());
  if (lines.includes(`${CACHE_DIRNAME}/`) || lines.includes(CACHE_DIRNAME)) return;
  fs.mkdirSync(path.dirname(excludeFile), { recursive: true });
  const separator = current && !current.endsWith("\n") ? "\n" : "";
  fs.appendFileSync(excludeFile, `${separator}${CACHE_DIRNAME}/\n`);
}

function ensureWorktree(context, cacheDir, info) {
  if (context.mode === "working-tree" || context.headSha === info.head) return null;
  if (!context.headAvailable) {
    warn(`commit ${context.headSha} is not available locally; reviewers will read the current checkout.`);
    return null;
  }
  const worktree = path.join(cacheDir, "worktree");
  git(["worktree", "prune"], info.repoRoot, { allowFail: true });
  if (fs.existsSync(worktree)) {
    const current = git(["rev-parse", "HEAD"], worktree, { allowFail: true });
    if (current === context.headSha) return worktree;
    git(["worktree", "remove", "--force", worktree], info.repoRoot, { allowFail: true });
    fs.rmSync(worktree, { recursive: true, force: true });
  }
  git(["worktree", "add", "--detach", "--quiet", worktree, context.headSha], info.repoRoot);
  return worktree;
}

function cleanup(cacheDir) {
  const meta = readJson(path.join(cacheDir, "meta.json"));
  if (!meta) fail(`no meta.json in ${cacheDir}`);
  if (meta.worktreePath && fs.existsSync(meta.worktreePath)) {
    git(["worktree", "remove", "--force", meta.worktreePath], meta.repoRoot, { allowFail: true });
    fs.rmSync(meta.worktreePath, { recursive: true, force: true });
    console.log(`Removed worktree ${meta.worktreePath}`);
  } else console.log("No worktree to remove.");
  git(["worktree", "prune"], meta.repoRoot, { allowFail: true });
}

// ---------------------------------------------------------------- main

function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === "cleanup") {
    if (!argv[1]) fail("cleanup requires <cacheDir>");
    return cleanup(path.resolve(argv[1]));
  }
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  const info = repoInfo();
  const config = readJson(path.join(info.repoRoot, CACHE_DIRNAME, "config.json")) ?? {};
  const context = resolveContext(options, config, info);
  if (context.changedFiles.length === 0) fail("the diff has no changed files.");

  const key = cacheKey(context);
  const cacheDir = path.join(info.repoRoot, CACHE_DIRNAME, key);
  fs.mkdirSync(cacheDir, { recursive: true });
  ensureExcluded(info);
  if (options.force) {
    for (const name of MODEL_ARTIFACTS) fs.rmSync(path.join(cacheDir, name), { force: true });
  }
  const paths = Object.fromEntries(
    Object.entries({
      request: "request.md",
      diff: "diff.patch",
      priorComments: "prior-comments.json",
      reviewerPrompt: "reviewer-prompt.md",
      synthesisPrompt: "synthesis-prompt.md",
      claude: "claude.md",
      opencode: "opencode.md",
      opencodeSkipped: "opencode.skipped.json",
      opencodeUsage: "opencode.usage.json",
      opencodeLog: "opencode.log",
      synthesis: "synthesis.md",
      findings: "findings.json",
      report: "report.html",
      artifact: "artifact.json",
      postResult: "post-result.json",
      meta: "meta.json",
    }).map(([name, file]) => [name, path.join(cacheDir, file)]),
  );
  const cached = {
    claude: nonEmpty(paths.claude),
    opencode: nonEmpty(paths.opencode),
    synthesis: nonEmpty(paths.synthesis),
  };
  if (!cached.synthesis) fs.rmSync(paths.opencodeSkipped, { force: true });

  const worktreePath = cached.synthesis ? null : ensureWorktree(context, cacheDir, info);

  fs.writeFileSync(paths.request, buildRequest(context));
  fs.writeFileSync(paths.diff, `${context.diff.trimEnd()}\n`);
  fs.writeFileSync(paths.priorComments, JSON.stringify(context.priorComments, null, 2));
  const reviewerTemplate = fs.readFileSync(path.join(SKILL_DIR, "prompts", "reviewer.md"), "utf8");
  const synthesisTemplate = fs.readFileSync(path.join(SKILL_DIR, "prompts", "synthesis.md"), "utf8");
  fs.writeFileSync(paths.reviewerPrompt, `${reviewerTemplate.trimEnd()}\n\nThe review request is at: ${paths.request}\n`);
  fs.writeFileSync(
    paths.synthesisPrompt,
    `${synthesisTemplate.trimEnd()}\n\nFiles (absolute paths):\n- Review request: ${paths.request}\n- Claude review: ${paths.claude}\n- GPT review: ${paths.opencode}\n`,
  );

  const meta = {
    version: 1,
    mode: context.mode,
    repoRoot: info.repoRoot,
    reviewCwd: worktreePath ?? info.repoRoot,
    worktreePath,
    cacheDir,
    cacheKey: key,
    repo: context.repo,
    prNumber: context.prNumber,
    prUrl: context.prUrl,
    prTitle: context.prTitle,
    headRef: context.headRef,
    headSha: context.headSha,
    baseRef: context.baseRef,
    baseSha: context.baseSha,
    mergeBase: context.mergeBase,
    changedFiles: context.changedFiles,
    priorCommentCount: context.priorComments.length,
    gptModel: options.model ?? config.model ?? DEFAULT_GPT_MODEL,
    claudeModel: options.claudeModel ?? config.claudeModel ?? null,
    post: options.post,
    pending: options.pending,
    force: options.force,
    createdAt: new Date().toISOString(),
    paths,
    cached,
  };
  fs.writeFileSync(paths.meta, JSON.stringify(meta, null, 2));
  process.stdout.write(`${JSON.stringify(meta, null, 2)}\n`);
  const target =
    context.mode === "pr" ? `PR #${context.prNumber}` : `${context.headRef} vs ${context.baseRef}`;
  console.error(
    `dual-review: ${context.mode} review of ${target} — ${context.changedFiles.length} file(s); cache ${cacheDir}${
      cached.synthesis ? " (synthesis cached)" : ""
    }`,
  );
}

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
