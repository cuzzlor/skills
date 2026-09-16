#!/usr/bin/env node
// pr-tidy: inventory the prose in a branch's changes and lint it for mannered-prose tells.
//
//   gather.mjs [--base <ref>] [--committed] [--whole-files] [--out <dir>] [-- <pathspec>...]
//   gather.mjs --check [--out <dir>]
//
// Writes <out>/inventory.json, <out>/candidates.md and <out>/digest.md, and prints digest.md.
// --check re-runs the inventory and lint, then reports what changed since the first run.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_BUFFER = 256 * 1024 * 1024;
const MAX_CANDIDATE_LINES_PER_FILE = 400;

const HELP = `pr-tidy gather — inventory the prose in this branch's changes.

Usage:
  gather.mjs [options] [-- <pathspec>...]
  gather.mjs --check [--out <dir>]

Options:
  --base <ref>      compare against this ref (default: origin/HEAD, else the gh default branch, else main)
  --committed       review committed changes only (default: also staged, unstaged and untracked files)
  --whole-files     treat every line of each changed file as in scope, not only added lines
  --report-only     recorded in the inventory; tells the skill to report findings instead of editing
  --out <dir>       output directory (default: a per-repo directory under the OS temp dir)
  --check           re-inventory, re-lint, and diff the working tree against the snapshot from the first run
  --json            print inventory.json instead of digest.md
`;

function fail(message) {
  console.error(`pr-tidy: ${message}`);
  process.exit(1);
}

function run(cmd, args, { cwd, allowFail = false, input } = {}) {
  try {
    return execFileSync(cmd, args, { cwd, input, encoding: "utf8", maxBuffer: MAX_BUFFER, stdio: ["pipe", "pipe", "pipe"] });
  } catch (error) {
    if (allowFail) return null;
    const stderr = error.stderr ? String(error.stderr).trim() : "";
    fail(`${cmd} ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`);
  }
}

function parseArgs(argv) {
  const opts = { base: null, committed: false, wholeFiles: false, reportOnly: false, out: null, check: false, json: false, pathspec: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      opts.pathspec = argv.slice(i + 1);
      break;
    }
    switch (arg) {
      case "--help":
      case "-h":
        console.log(HELP);
        process.exit(0);
      case "--base":
        opts.base = argv[++i] ?? fail("--base needs a ref");
        break;
      case "--committed":
        opts.committed = true;
        break;
      case "--whole-files":
        opts.wholeFiles = true;
        break;
      case "--report-only":
        opts.reportOnly = true;
        break;
      case "--out":
        opts.out = argv[++i] ?? fail("--out needs a directory");
        break;
      case "--check":
        opts.check = true;
        break;
      case "--json":
        opts.json = true;
        break;
      default:
        fail(`unknown argument ${arg}\n\n${HELP}`);
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Git

function repoRoot() {
  const root = run("git", ["rev-parse", "--show-toplevel"], { allowFail: true });
  if (!root) fail("not inside a git repository");
  return root.trim();
}

function resolveBase(cwd, requested) {
  const candidates = [];
  if (requested) candidates.push(requested);
  const originHead = run("git", ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], { cwd, allowFail: true });
  if (originHead) candidates.push(originHead.trim());
  if (!requested) {
    const gh = run("gh", ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"], { cwd, allowFail: true });
    if (gh && gh.trim()) candidates.push(`origin/${gh.trim()}`, gh.trim());
    candidates.push("origin/main", "main", "origin/master", "master");
  }
  for (const candidate of candidates) {
    if (run("git", ["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`], { cwd, allowFail: true })) return candidate;
  }
  fail(requested ? `could not resolve --base ${requested}` : "could not determine a base branch; pass --base <ref>");
}

function changedFiles(cwd, mergeBase, committed, pathspec) {
  const target = committed ? ["HEAD"] : [];
  const out = run("git", ["diff", "--name-status", "-M", "--no-renames", mergeBase, ...target, "--", ...pathspec], { cwd }) ?? "";
  const files = new Map();
  for (const line of out.split("\n")) {
    if (!line) continue;
    const [status, ...rest] = line.split("\t");
    files.set(rest[rest.length - 1], { status: status[0] });
  }
  if (!committed) {
    const untracked = run("git", ["ls-files", "--others", "--exclude-standard", "--", ...pathspec], { cwd }) ?? "";
    for (const file of untracked.split("\n")) if (file) files.set(file, { status: "A", untracked: true });
  }
  return files;
}

// Line numbers (in the new file) that the diff added or changed.
function addedLines(cwd, mergeBase, committed, file) {
  const target = committed ? ["HEAD"] : [];
  const out = run("git", ["diff", "-U0", "--no-color", mergeBase, ...target, "--", file], { cwd, allowFail: true }) ?? "";
  const lines = new Set();
  for (const line of out.split("\n")) {
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!m) continue;
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    for (let n = start; n < start + count; n++) lines.add(n);
  }
  return lines;
}

function branchCommits(cwd, mergeBase) {
  const out = run("git", ["log", "--format=%h%x00%s%x00%b%x1e", `${mergeBase}..HEAD`], { cwd, allowFail: true }) ?? "";
  return out
    .split("\x1e")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, subject, body] = record.split("\x00");
      return { sha, subject, body: (body ?? "").trim() };
    });
}

// ---------------------------------------------------------------------------
// Classification

const DOC_EXT = new Set([".md", ".mdx", ".markdown", ".rst", ".adoc", ".asciidoc", ".txt"]);
const SCHEMA_EXT = new Set([".graphql", ".gql", ".graphqls", ".proto", ".prisma"]);
const UI_EXT = new Set([".tsx", ".jsx", ".vue", ".svelte", ".html", ".astro"]);
const CODE_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue", ".svelte", ".astro",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".kts", ".scala", ".cs", ".fs", ".swift", ".m", ".mm",
  ".c", ".h", ".cc", ".cpp", ".hpp", ".php", ".sh", ".bash", ".zsh", ".ps1", ".sql", ".tf", ".hcl",
  ".yaml", ".yml", ".toml", ".ini", ".cfg", ".graphql", ".gql", ".graphqls", ".proto", ".prisma", ".css", ".scss", ".less", ".bicep",
]);
const I18N_PATTERN = /(^|\/)(locales?|i18n|translations?|lang|messages|strings)(\/|\.)|\.(po|pot|resx|strings|xlf|xliff|arb)$|(^|\/)[a-z]{2}(-[A-Z]{2})?\.json$/;
const OPENAPI_PATTERN = /(^|\/)(openapi|swagger|api-?spec)[^/]*\.(ya?ml|json)$/i;
const TEST_PATTERN = /(^|\/)(__tests__|__mocks__|test|tests|spec|fixtures?|e2e|cypress|playwright|storybook|stories)\/|\.(test|spec|stories|e2e|fixture)\.[cm]?[jt]sx?$/;
const SKIP_PATTERN = /(^|\/)(node_modules|dist|build|coverage|\.next|\.turbo|generated|__generated__|__snapshots__)\/|\.(lock|snap|min\.js|map|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|pdf)$|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|CHANGELOG\.md)$|\.generated\.|\.d\.ts$/;

// Comment syntaxes by extension. `line` matches a line that is entirely a comment; `blockStart`/`blockEnd` delimit block comments.
const HASH = { line: /^\s*#(?!!)/, blockStart: null, blockEnd: null };
const C_LIKE = { line: /^\s*(\/\/|\*\/?|\/\*)/, blockStart: /\/\*/, blockEnd: /\*\//, tripleSlash: /^\s*\/\/\// };
const PY = { line: /^\s*#/, blockStart: /^\s*[ru]?("""|''')/, blockEnd: /("""|''')\s*$/ };
const SQL = { line: /^\s*(--|\/\*|\*)/, blockStart: /\/\*/, blockEnd: /\*\// };
const HTML = { line: /^\s*<!--/, blockStart: /<!--/, blockEnd: /-->/ };
const GRAPHQL = { line: /^\s*(#|"""|")/, blockStart: /"""/, blockEnd: /"""/ };
const COMMENT_SYNTAX = {
  ".ts": C_LIKE, ".tsx": C_LIKE, ".js": C_LIKE, ".jsx": C_LIKE, ".mjs": C_LIKE, ".cjs": C_LIKE, ".mts": C_LIKE, ".cts": C_LIKE,
  ".java": C_LIKE, ".kt": C_LIKE, ".kts": C_LIKE, ".scala": C_LIKE, ".cs": C_LIKE, ".swift": C_LIKE, ".go": C_LIKE, ".rs": C_LIKE,
  ".c": C_LIKE, ".h": C_LIKE, ".cc": C_LIKE, ".cpp": C_LIKE, ".hpp": C_LIKE, ".php": C_LIKE, ".css": C_LIKE, ".scss": C_LIKE, ".less": C_LIKE,
  ".proto": C_LIKE, ".prisma": C_LIKE, ".bicep": C_LIKE, ".tf": HASH, ".hcl": HASH,
  ".py": PY, ".rb": HASH, ".sh": HASH, ".bash": HASH, ".zsh": HASH, ".ps1": HASH, ".yaml": HASH, ".yml": HASH, ".toml": HASH, ".ini": HASH, ".cfg": HASH,
  ".sql": SQL, ".html": HTML, ".vue": { ...C_LIKE, html: HTML }, ".svelte": { ...C_LIKE, html: HTML }, ".astro": { ...C_LIKE, html: HTML },
  ".graphql": GRAPHQL, ".gql": GRAPHQL, ".graphqls": GRAPHQL,
};

// Code-first schema builders and decorators that carry public API descriptions.
const SCHEMA_CODE_SIGNAL = /from\s+["'](graphql|@pothos\/|nexus|type-graphql|@nestjs\/graphql|@graphql-tools|graphql-compose|@apollo\/server|graphql-yoga|@graphql-yoga|grafast|postgraphile)|\bbuilder\.(objectType|queryType|mutationType|inputType|enumType|interfaceType|unionType|queryField|mutationField|objectRef)\(|\b(objectType|inputObjectType|enumType|extendType|makeSchema|mutationField|queryField)\(|new\s+GraphQL(Object|Input|Enum|Interface|Union|Scalar)Type\(|@(ObjectType|InputType|ArgsType|Resolver|Field|Query|Mutation)\(/;
const INLINE_SCHEMA_PATTERN = /\b(description|deprecationReason|deprecated)\s*[:(]\s*["'`]|@Field\(|@ObjectType\(|@InputType\(|@ArgsType\(|\.description\(|summary:\s*["'`]|\/\*\*[^*]*@(summary|description)/;
const GQL_TEMPLATE_PATTERN = /\b(gql|graphql)`|#graphql/;
// Strings likely shown to a user: JSX text, common UI props, thrown user errors, validation messages, notifications.
const UI_PROP_PATTERN = /\b(label|title|placeholder|aria-label|ariaLabel|alt|helperText|description|tooltip|heading|subheading|caption|emptyText|emptyMessage|loadingText|confirmText|cancelText|successMessage|errorMessage|message|text)\s*[=:]\s*["'`{]/;
const UI_CALL_PATTERN = /\b(toast|notify|notification|snackbar|alert|confirm|showMessage|setError|setStatus|t)\s*(\.\w+)?\(\s*["'`]/;
const USER_ERROR_PATTERN = /\bnew\s+(GraphQLError|UserInputError|ForbiddenError|AuthenticationError|ValidationError|BadRequest\w*|NotFound\w*|Conflict\w*|Unprocessable\w*|HttpException|ApiError|UserError|DomainError)\s*\(\s*["'`]|\.(min|max|length|email|url|regex|refine|nonempty|required|invalid_type_error|message)\s*\([^)]*["'`][A-Z]/;
const JSX_TEXT_PATTERN = />\s*[A-Z][^<>{}]{2,}\s*</;
const TITLE_STRING_PATTERN = /["'`]([A-Z][a-z][^"'`]{2,}?(\s[^"'`]+){1,})["'`]/;

function classifyFile(file) {
  const ext = path.extname(file).toLowerCase();
  const base = path.basename(file);
  const categories = new Set();
  if (DOC_EXT.has(ext) || /^(README|CONTRIBUTING|CHANGELOG|LICENSE|SECURITY|ARCHITECTURE|DECISIONS?|ADR)/i.test(base) || /(^|\/)docs?\//.test(file)) categories.add("docs");
  if (SCHEMA_EXT.has(ext) || OPENAPI_PATTERN.test(file) || /schema\.json$/.test(file)) categories.add("schema");
  if (I18N_PATTERN.test(file)) categories.add("ui");
  if (CODE_EXT.has(ext) && !categories.has("docs")) categories.add("code");
  if (UI_EXT.has(ext)) categories.add("ui");
  return { ext, categories };
}

// Extract prose-bearing lines from a file's content. Returns [{ line, kind, text }].
function extractCandidates(file, content, inScope, { ext, categories }) {
  const lines = content.split("\n");
  const out = [];
  const syntax = COMMENT_SYNTAX[ext];
  let inBlock = false;
  let blockEnd = null;
  let inGqlTemplate = false;
  let inFrontMatter = false;
  let inFence = false;
  const isDoc = categories.has("docs");
  const isSchemaFile = categories.has("schema");
  const isI18n = I18N_PATTERN.test(file) && /\.(json|ya?ml|po|pot|resx|strings|xlf|xliff|arb)$/.test(file);
  const isTest = TEST_PATTERN.test(file);
  const schemaCode = !isDoc && !isSchemaFile && SCHEMA_CODE_SIGNAL.test(content);

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    const n = i + 1;
    const trimmed = text.trim();
    let kind = null;

    if (isDoc) {
      if (n === 1 && trimmed === "---") { inFrontMatter = true; continue; }
      if (inFrontMatter) { if (trimmed === "---") inFrontMatter = false; continue; }
      if (/^(```|~~~)/.test(trimmed)) { inFence = !inFence; continue; }
      if (inFence || !trimmed) continue;
      if (/^\|[\s:-|]+\|$/.test(trimmed)) continue; // table separator
      if (/^<!--.*-->$/.test(trimmed)) continue;
      kind = "doc";
    } else if (isSchemaFile && GRAPHQL === syntax) {
      const quotes = (text.match(/"""/g) || []).length;
      if (inBlock) {
        kind = "schema-description";
        if (quotes % 2 === 1) inBlock = false;
      } else if (quotes % 2 === 1) {
        inBlock = true;
        kind = trimmed === '"""' ? null : "schema-description";
      } else if (quotes >= 2 || /^\s*"[^"]*"\s*$/.test(text)) {
        kind = "schema-description";
      } else if (/^\s*#/.test(text)) {
        kind = "comment";
      } else if (/@deprecated\s*\(\s*reason\s*:/.test(text)) {
        kind = "schema-description";
      }
    } else if (isSchemaFile) {
      // OpenAPI / JSON schema / proto / prisma: descriptions, summaries, titles and doc comments.
      if (/^\s*"?(description|summary|title|x-\w+-description)"?\s*:/.test(text) || /^\s*-?\s*(description|summary):/.test(text)) kind = "schema-description";
      else if (syntax && (syntax.line.test(text) || (syntax.tripleSlash && syntax.tripleSlash.test(text)))) kind = "comment";
    } else if (isI18n) {
      if (/^\s*"[^"]+"\s*:\s*"/.test(text) || /^\s*msgstr\s+"/.test(text) || /<value>/.test(text) || /^\s*[\w.-]+\s*:\s*["']?[A-Za-z]/.test(text)) kind = "ui-text";
    } else if (syntax) {
      // Block comments
      if (inBlock) {
        kind = "comment";
        if (blockEnd && blockEnd.test(text)) { inBlock = false; blockEnd = null; }
      } else if (syntax.blockStart && syntax.blockStart.test(text) && !(syntax.blockEnd && syntax.blockEnd.test(text.slice(text.search(syntax.blockStart) + 2)))) {
        // A block that opens on this line and does not close on the same line.
        inBlock = true;
        blockEnd = syntax.blockEnd;
        kind = "comment";
      } else if (syntax.html && syntax.html.blockStart.test(text) && !syntax.html.blockEnd.test(text)) {
        inBlock = true;
        blockEnd = syntax.html.blockEnd;
        kind = "comment";
      } else if (syntax.line.test(text) || (syntax.html && syntax.html.line.test(text))) {
        kind = "comment";
      } else if (/\/\*.*\*\//.test(text) && !/["'`].*\/\*.*["'`]/.test(text)) {
        kind = "comment-inline";
      } else if (/\s\/\/\s/.test(text) && !/["'`][^"'`]*\/\/[^"'`]*["'`]/.test(text)) {
        kind = "comment-inline";
      }

      // Embedded GraphQL SDL in template literals.
      if (!kind) {
        if (inGqlTemplate) {
          if (/^\s*"""|"""\s*$|^\s*"[^"]*"\s*$/.test(text)) kind = "schema-description";
          else if (/^\s*#/.test(text)) kind = "comment";
          if (/`/.test(text)) inGqlTemplate = false;
        } else if (GQL_TEMPLATE_PATTERN.test(text) && (text.match(/`/g) || []).length % 2 === 1) {
          inGqlTemplate = true;
        }
      }

      if (!kind && schemaCode && INLINE_SCHEMA_PATTERN.test(text)) kind = "schema-description";
      if (!kind && !isTest) {
        if (categories.has("ui") && (JSX_TEXT_PATTERN.test(text) || UI_PROP_PATTERN.test(text))) kind = "ui-text";
        else if (USER_ERROR_PATTERN.test(text) || UI_CALL_PATTERN.test(text)) kind = "ui-text";
        else if (categories.has("ui") && TITLE_STRING_PATTERN.test(text) && !/^\s*(import|export|from|require|console\.|log)/.test(trimmed)) kind = "ui-text?";
      }
    }

    if (!kind) continue;
    if (!inScope(n)) continue;
    if (!/[A-Za-z]{2,}/.test(text)) continue; // no words
    if (/^\s*(\/\/|#|\*|\/\*+|<!--)?\s*(eslint|prettier|ts-|@ts-|biome-|noqa|pylint|type:|istanbul|c8|v8|sourceMappingURL|SPDX|Copyright|\(c\)|©|region|endregion|pragma|TODO\(|FIXME\()/i.test(text)) continue;
    out.push({ line: n, kind, text: text.length > 400 ? `${text.slice(0, 400)}…` : text });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lint: mannered-prose tells and leak indicators. Every pattern is a hint for a human-quality judgement,
// never a verdict; the SKILL and references decide what to do with a hit.

const TELLS = [
  // Vocabulary: filler, self-praise, hedges, and STE-unapproved words with a plain equivalent.
  ["filler", /\b(in order to|for the purpose of|it is (important|worth) (to )?not(e|ing)|note that|please note|it should be noted|needless to say|as (you can|we) (can )?see|basically|essentially|actually|simply|just|easily|of course|obviously|clearly|very|really|quite|somewhat|fairly|a (little|bit|number of|variety of|range of)|the fact that|at this point in time|in the event that|in terms of|with regard to|with respect to|due to the fact|on the other hand|going forward|at the end of the day|when it comes to|first and foremost)\b/i],
  ["self-praise", /\b(robust|seamless(ly)?|elegant(ly)?|comprehensive(ly)?|powerful|cutting[- ]edge|state[- ]of[- ]the[- ]art|best[- ]in[- ]class|world[- ]class|intuitive|effortless(ly)?|beautiful(ly)?|clean(ly)?|gracefully|nicely|neatly|perfectly|blazing(ly)?[- ]fast|lightning[- ]fast|highly|truly|incredibly|extremely|super|rich|delightful|smart|clever|sophisticated|advanced|modern|efficient(ly)?|optimal|first-class)\b/i],
  ["ai-vocabulary", /\b(delve|delves|delving|leverage[sd]?|leveraging|utili[sz]e[sd]?|utili[sz]ing|utili[sz]ation|facilitate[sd]?|streamline[sd]?|streamlining|empower(s|ed|ing)?|harness(es|ed|ing)?|unlock(s|ed|ing)?|elevate[sd]?|enhance[sd]?|enhancing|foster(s|ed|ing)?|underpin(s|ned|ning)?|pivotal|crucial|vital|paramount|holistic|synerg(y|ies|istic)|tapestry|landscape|realm|journey|navigate|navigating|orchestrate[sd]?|encompass(es|ed|ing)?|multifaceted|nuanced|meticulous(ly)?|intricate|myriad|plethora|granular|bespoke|ecosystem|paradigm|game[- ]changer|cornerstone|bedrock|testament|beacon|dive (deep|into)|deep[- ]dive|at its core|in essence|in today's|ever-evolving|it's worth|worth noting|importantly|notably|interestingly|crucially|significantly|arguably|ultimately|undoubtedly|remember that|keep in mind|bear in mind|think of (it|this) as|acts? as a|serves? as a|plays? a (key|crucial|vital|central|critical) role|is (key|central|critical|essential) to)\b/i],
  ["hedge", /\b(may want to|might want to|you may|you might|could potentially|potentially|arguably|generally speaking|in most cases|typically|it is (likely|possible) that|should (generally|typically|usually)|tends? to|kind of|sort of|more or less|somewhat|perhaps|maybe|seems? to|appears? to|hopefully|ideally)\b/i],
  ["narration", /\b(this (function|method|class|module|file|component|hook|type|interface|helper|utility|script|section|document|page|guide) (is|will|does|provides|contains|describes|handles|implements|defines|represents|exposes|is responsible)|is responsible for|is used to|is designed to|is intended to|is meant to|allows? (you|us|the user|users|callers?) to|enables? (you|us|the user|users) to|helps? (you|us|to)|lets? (you|us)|makes? it (possible|easy|easier|simple) to|provides? (a|the) (ability|way|means) to|in this (section|document|file|guide|module),?|the following (section|code|function|snippet)|as (mentioned|described|noted|discussed|shown) (above|below|earlier|previously)|see (above|below))\b/i],
  ["change-narration", /\b(updated to|changed to|refactored|now (uses|returns|supports|handles|accepts|takes|calls|checks)|no longer|previously|used to|was (moved|renamed|changed|updated|added|removed)|has been (moved|renamed|changed|updated|added|removed|refactored)|new(ly)? (added|implementation)|added (support for|to support)|to (address|fix) (the )?(issue|bug|feedback|review|comment)|per (the )?(review|feedback|discussion)|as (requested|discussed|per))\b/i],
  ["restating-code", /^\s*(\/\/|#|\*|\/\*+|<!--)?\s*(increment|decrement|set|get|return|returns|check|checks|call|calls|create|creates|initiali[sz]e|loop (over|through)|iterate (over|through)|import|define|declare|assign|log|print|throw|catch|if|else|otherwise|handle) (the |a |an )?[\w.]+( (to|from|of|by|for) [\w.]+)?\.?\s*(-->|\*\/)?\s*$/i],
  ["second-person-marketing", /\b(you'll (love|find|see|notice|appreciate)|we (are|'re) (excited|proud|happy|pleased|thrilled)|feel free to|don't hesitate|happy (coding|hacking)|enjoy!|good luck|have fun|welcome to|thank you for|thanks for)\b/i],
  ["antithesis", /\b(not (just|only|merely|simply) .{2,60}?,? but (also )?|isn't (just|only|about) .{2,40} — it's|rather than (just|simply|merely)|is more than (just )?a|goes beyond|beyond (just|simply|merely))/i],
  ["rhetorical-question", /^\s*(\/\/|#|\*|<!--)?\s*(why|what|how|when|where|who|so what|ever wonder|wondering|want to|need to|looking for)\b[^?]{2,80}\?\s*$/i],
  ["rule-of-three", /\b(\w+(ly|ive|ful|able|ible|ous|al|ent|ant|ic|less)), (\w+(ly|ive|ful|able|ible|ous|al|ent|ant|ic|less)),? (and|or) \w+\b/i],
  ["em-dash", /\s—\s|—|\s–\s|\s--\s/],
  ["exclamation", /[A-Za-z)]!(?!=)/],
  ["please", /\bplease\b/i],
  ["ensure", /\bensur(e|es|ed|ing)\b/i],
  ["allow-enable", /\b(allow|allows|allowing|enable|enables|enabling)\b/i],
  ["etc", /\b(etc\.?|and so on|and more|among others|and the like)\b/i],
  ["gerund-heading", /^\s*#{1,6}\s+\w+ing\b/],
  ["long-sentence", /(?:^|[.!?]\s+)(?:[`\w[\]()/-]+[^\w.!?`\[\]()/-]+){28,}[`\w[\]()/-]+[.!?]/],
  ["bold-lead-in", /^\s*[-*]\s+\*\*[^*]+\*\*[:\s]/],
  ["noun-cluster", /\b([A-Z][a-z]+ ){3,}[A-Z][a-z]+\b/],
  ["parenthetical", /\((e\.g\.|i\.e\.|for example|such as|see |note)/i],
  // Leak indicators: words that usually mean an implementation detail is in a public description.
  ["leak", /\b(database|db|table|column|row|index|cache[sd]?|caching|redis|postgres(ql)?|sql|typeorm|prisma|migration|resolver|loader|dataloader|service|repository|entity|entities|queue|job|worker|cron|bullmq|kafka|lambda|internal(ly)?|legacy|deprecated in favou?r|ticket|jira|PR|pull request|issue #|refactor|hack|workaround|for now|temporary|temporarily|in the future|eventually|TODO|FIXME|the UI|the frontend|the client|the backend|the server|on the server|server[- ]side|client[- ]side|under the hood|behind the scenes|we|our|us|the team|staff)\b/i],
  ["tech-leak", /\b(database|db|sql|postgres(ql)?|redis|resolver|graphql|api|endpoint|server|backend|frontend|client|cache|queue|worker|cron|job|migration|typeorm|prisma|lambda|entity|dataloader|token|jwt|payload|request|response|status code|[45]\d\d|timeout|null|undefined|NaN|exception|stack trace|stacktrace|error code|internal)\b/i],
  ["ui-blame", /\b(you (entered|provided|forgot|failed|must|need to|didn't|did not)|invalid|illegal|forbidden|mandatory|fatal|oops|whoops|uh-oh|sorry|something went wrong|an error (has )?occurred|unexpected error|unknown error|failed to|error:)\b/i],
];

// Which tells apply to which candidate kinds.
const KIND_TELLS = {
  "doc": new Set(["filler", "self-praise", "ai-vocabulary", "hedge", "narration", "change-narration", "second-person-marketing", "antithesis", "rhetorical-question", "rule-of-three", "em-dash", "exclamation", "please", "ensure", "allow-enable", "etc", "gerund-heading", "long-sentence", "bold-lead-in", "noun-cluster", "parenthetical"]),
  "comment": new Set(["filler", "self-praise", "ai-vocabulary", "hedge", "narration", "change-narration", "restating-code", "antithesis", "rhetorical-question", "rule-of-three", "em-dash", "exclamation", "please", "ensure", "allow-enable", "etc", "long-sentence", "noun-cluster"]),
  "comment-inline": new Set(["filler", "self-praise", "ai-vocabulary", "hedge", "narration", "change-narration", "restating-code", "em-dash", "please", "ensure", "etc"]),
  "schema-description": new Set(["filler", "self-praise", "ai-vocabulary", "hedge", "narration", "change-narration", "antithesis", "rule-of-three", "em-dash", "exclamation", "please", "ensure", "allow-enable", "etc", "long-sentence", "parenthetical", "leak"]),
  "ui-text": new Set(["filler", "self-praise", "ai-vocabulary", "hedge", "exclamation", "please", "etc", "tech-leak", "ui-blame", "em-dash"]),
  "ui-text?": new Set(["filler", "self-praise", "exclamation", "please", "tech-leak", "ui-blame"]),
};

function lintCandidate(candidate) {
  const applicable = KIND_TELLS[candidate.kind] ?? new Set();
  const hits = [];
  for (const [name, pattern] of TELLS) {
    if (!applicable.has(name)) continue;
    const m = pattern.exec(candidate.text);
    if (m) hits.push({ tell: name, match: m[0].length > 60 ? `${m[0].slice(0, 60)}…` : m[0] });
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Inventory

function outDir(cwd, requested) {
  if (requested) return path.resolve(requested);
  const key = createHash("sha1").update(cwd).digest("hex").slice(0, 12);
  return path.join(os.tmpdir(), "pr-tidy", `${path.basename(cwd)}-${key}`);
}

function readWorkingFile(cwd, file, committed) {
  if (committed) return run("git", ["show", `HEAD:${file}`], { cwd, allowFail: true });
  const abs = path.join(cwd, file);
  if (!fs.existsSync(abs)) return null;
  const stat = fs.statSync(abs);
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) return null;
  const buf = fs.readFileSync(abs);
  if (buf.subarray(0, 8000).includes(0)) return null; // binary
  return buf.toString("utf8");
}

function buildInventory(cwd, opts, previous) {
  const base = opts.base ?? previous?.base ?? null;
  const baseRef = resolveBase(cwd, base);
  const head = run("git", ["rev-parse", "HEAD"], { cwd }).trim();
  const mergeBase = run("git", ["merge-base", baseRef, "HEAD"], { cwd, allowFail: true })?.trim() ?? head;
  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd }).trim();
  const committed = opts.committed || previous?.committed || false;
  const wholeFiles = opts.wholeFiles || previous?.wholeFiles || false;
  const pathspec = opts.pathspec.length ? opts.pathspec : previous?.pathspec ?? [];

  const files = [];
  let skipped = 0;
  for (const [file, meta] of changedFiles(cwd, mergeBase, committed, pathspec)) {
    if (meta.status === "D") continue;
    if (SKIP_PATTERN.test(file)) { skipped++; continue; }
    const classification = classifyFile(file);
    const content = readWorkingFile(cwd, file, committed);
    if (content === null) { skipped++; continue; }
    const added = meta.untracked || wholeFiles ? null : addedLines(cwd, mergeBase, committed, file);
    const inScope = added ? (n) => added.has(n) : () => true;
    let candidates = extractCandidates(file, content, inScope, classification);
    let truncated = false;
    if (candidates.length > MAX_CANDIDATE_LINES_PER_FILE) { candidates = candidates.slice(0, MAX_CANDIDATE_LINES_PER_FILE); truncated = true; }
    for (const c of candidates) c.hits = lintCandidate(c);
    const kinds = {};
    for (const c of candidates) kinds[c.kind] = (kinds[c.kind] ?? 0) + 1;
    files.push({
      file,
      status: meta.status,
      untracked: Boolean(meta.untracked),
      categories: [...classification.categories],
      addedLines: added ? added.size : content.split("\n").length,
      kinds,
      hitCount: candidates.reduce((n, c) => n + c.hits.length, 0),
      truncated,
      candidates,
    });
  }
  files.sort((a, b) => b.hitCount - a.hitCount || b.candidates.length - a.candidates.length || a.file.localeCompare(b.file));

  return {
    repo: cwd,
    branch,
    head,
    base: baseRef,
    mergeBase,
    committed,
    wholeFiles,
    reportOnly: opts.reportOnly,
    pathspec,
    generatedAt: new Date().toISOString(),
    commits: branchCommits(cwd, mergeBase),
    files,
    skipped,
  };
}

function snapshot(cwd) {
  // A commit object of the current index + working tree (tracked files), without touching refs.
  const sha = run("git", ["stash", "create"], { cwd, allowFail: true })?.trim();
  const untracked = (run("git", ["ls-files", "--others", "--exclude-standard"], { cwd }) ?? "").split("\n").filter(Boolean);
  const untrackedHashes = {};
  for (const file of untracked) {
    const abs = path.join(cwd, file);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) untrackedHashes[file] = createHash("sha1").update(fs.readFileSync(abs)).digest("hex");
  }
  return { sha: sha || run("git", ["rev-parse", "HEAD"], { cwd }).trim(), untrackedHashes };
}

// ---------------------------------------------------------------------------
// Rendering

const KIND_LABEL = { "doc": "doc", "comment": "comment", "comment-inline": "inline comment", "schema-description": "schema", "ui-text": "ui text", "ui-text?": "ui text?" };

function summariseKinds(kinds) {
  return Object.entries(kinds).map(([k, n]) => `${n} ${KIND_LABEL[k] ?? k}`).join(", ") || "—";
}

function renderDigest(inv, dir) {
  const totalCandidates = inv.files.reduce((n, f) => n + f.candidates.length, 0);
  const totalHits = inv.files.reduce((n, f) => n + f.hitCount, 0);
  const tellCounts = {};
  const kindTotals = {};
  for (const f of inv.files) for (const c of f.candidates) {
    kindTotals[c.kind] = (kindTotals[c.kind] ?? 0) + 1;
    for (const h of c.hits) tellCounts[h.tell] = (tellCounts[h.tell] ?? 0) + 1;
  }
  const categories = new Set(inv.files.filter((f) => f.candidates.length).flatMap((f) => f.categories));
  const lines = [];
  lines.push(`# pr-tidy inventory`);
  lines.push("");
  lines.push(`- Repo: \`${inv.repo}\``);
  lines.push(`- Branch: \`${inv.branch}\` at \`${inv.head.slice(0, 10)}\`; base \`${inv.base}\` (merge-base \`${inv.mergeBase.slice(0, 10)}\`)`);
  lines.push(`- Mode: ${inv.reportOnly ? "report only (no edits)" : "edit"}`);
  lines.push(`- Scope: ${inv.committed ? "committed changes only" : "committed + staged + unstaged + untracked"}${inv.wholeFiles ? "; whole files" : "; added/changed lines only"}${inv.pathspec.length ? `; pathspec ${inv.pathspec.join(" ")}` : ""}`);
  lines.push(`- Files: ${inv.files.length} reviewed, ${inv.files.filter((f) => f.candidates.length).length} with prose, ${inv.skipped} skipped (generated, binary, lockfiles)`);
  lines.push(`- Prose lines: ${totalCandidates} (${summariseKinds(kindTotals)}); lint hits: ${totalHits}`);
  lines.push(`- Categories present: ${[...categories].sort().join(", ") || "none"}`);
  lines.push(`- Detail: \`${path.join(dir, "candidates.md")}\` (prose lines with numbers and hits), \`${path.join(dir, "inventory.json")}\``);
  lines.push("");
  if (inv.commits.length) {
    lines.push(`## Commits on the branch (${inv.commits.length})`);
    lines.push("");
    for (const c of inv.commits.slice(0, 30)) lines.push(`- \`${c.sha}\` ${c.subject}`);
    if (inv.commits.length > 30) lines.push(`- … ${inv.commits.length - 30} more`);
    lines.push("");
  }
  lines.push(`## Files with prose`);
  lines.push("");
  lines.push(`| File | Status | Categories | Prose lines | Lint hits |`);
  lines.push(`| --- | --- | --- | --- | --- |`);
  for (const f of inv.files) {
    if (!f.candidates.length) continue;
    lines.push(`| \`${f.file}\` | ${f.status}${f.untracked ? " (untracked)" : ""} | ${f.categories.join(", ")} | ${summariseKinds(f.kinds)}${f.truncated ? " (truncated)" : ""} | ${f.hitCount} |`);
  }
  const noProse = inv.files.filter((f) => !f.candidates.length);
  if (noProse.length) {
    lines.push("");
    lines.push(`Changed files with no prose detected (${noProse.length}): ${noProse.map((f) => `\`${f.file}\``).join(", ")}`);
  }
  if (totalHits) {
    lines.push("");
    lines.push(`## Lint hits by tell`);
    lines.push("");
    for (const [tell, n] of Object.entries(tellCounts).sort((a, b) => b[1] - a[1])) lines.push(`- ${tell}: ${n}`);
  }
  return lines.join("\n") + "\n";
}

function renderCandidates(inv) {
  const lines = [`# pr-tidy prose candidates`, "", `Line numbers refer to the current file. \`kind\` says how the line was detected; \`ui text?\` is a weak guess. Tells are hints, not verdicts.`, ""];
  for (const f of inv.files) {
    if (!f.candidates.length) continue;
    lines.push(`## ${f.file}`);
    lines.push("");
    lines.push(`categories: ${f.categories.join(", ")}; ${summariseKinds(f.kinds)}; ${f.hitCount} hits${f.truncated ? `; truncated to ${MAX_CANDIDATE_LINES_PER_FILE} lines` : ""}`);
    lines.push("");
    for (const c of f.candidates) {
      const hits = c.hits.length ? `  ⟵ ${c.hits.map((h) => `${h.tell}: "${h.match}"`).join("; ")}` : "";
      lines.push(`${String(c.line).padStart(5)} [${KIND_LABEL[c.kind] ?? c.kind}] ${c.text}${hits}`);
    }
    lines.push("");
  }
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Check mode

const GRAPHQL_STRUCTURE = /^\s*(type|input|enum|interface|union|scalar|extend|directive|schema|query|mutation|subscription|fragment)\b|^\s*[A-Za-z_]\w*\s*[(:]|^\s*[{}]|^\s*@|^\s*"""|^\s*#|[{}]\s*$/;

// The line with string-literal contents and comment text blanked out: what must not change when only prose is edited.
function skeleton(file, text) {
  const { ext } = classifyFile(file);
  const syntax = COMMENT_SYNTAX[ext];
  // In SDL, a line that is not a definition, field, brace, directive or comment is description text.
  if (syntax === GRAPHQL && !GRAPHQL_STRUCTURE.test(text)) return "";
  let s = text;
  s = s.replace(/"""[\s\S]*?"""|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, (m) => m[0] + m[0]);
  if (syntax === HASH || syntax === PY) s = s.replace(/(^|\s)#.*$/, "$1#");
  else if (syntax === SQL) s = s.replace(/--.*$/, "--");
  if (syntax && syntax !== HASH && syntax !== PY) s = s.replace(/\/\/.*$/, "//").replace(/\/\*[\s\S]*?\*\//g, "/**/").replace(/^\s*\*.*$/, "*");
  s = s.replace(/<!--[\s\S]*?-->/g, "<!---->").replace(/>[^<>{}]+</g, "><");
  return s.trim();
}

function renderCheck(cwd, before, after, dir) {
  const lines = [`# pr-tidy check`, ""];
  const beforeHits = before.files.reduce((n, f) => n + f.hitCount, 0);
  const afterHits = after.files.reduce((n, f) => n + f.hitCount, 0);
  const beforeLines = before.files.reduce((n, f) => n + f.candidates.length, 0);
  const afterLines = after.files.reduce((n, f) => n + f.candidates.length, 0);
  lines.push(`- Prose lines: ${beforeLines} → ${afterLines}`);
  lines.push(`- Lint hits: ${beforeHits} → ${afterHits}`);

  // What the tidy pass changed since the snapshot.
  const snap = before.snapshot;
  const stat = run("git", ["diff", "--stat", snap.sha, "--"], { cwd, allowFail: true }) ?? "";
  const numstat = run("git", ["diff", "--numstat", snap.sha, "--"], { cwd, allowFail: true }) ?? "";
  const touched = numstat.split("\n").filter(Boolean).map((l) => l.split("\t")[2]);
  const untrackedNow = (run("git", ["ls-files", "--others", "--exclude-standard"], { cwd }) ?? "").split("\n").filter(Boolean);
  const untrackedChanged = untrackedNow.filter((f) => {
    const abs = path.join(cwd, f);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return false;
    const h = createHash("sha1").update(fs.readFileSync(abs)).digest("hex");
    return snap.untrackedHashes[f] !== h;
  });
  lines.push(`- Files edited by the tidy pass: ${touched.length + untrackedChanged.length}`);
  lines.push("");
  if (stat.trim()) { lines.push("```"); lines.push(stat.trimEnd()); lines.push("```"); lines.push(""); }
  if (untrackedChanged.length) lines.push(`Untracked files edited: ${untrackedChanged.map((f) => `\`${f}\``).join(", ")}`, "");

  // Hunks the tidy pass changed where the code skeleton (everything outside strings and comments) changed too.
  const suspicious = [];
  const patch = run("git", ["diff", "-U0", "--no-color", snap.sha, "--"], { cwd, allowFail: true }) ?? "";
  const DELIMITER = /^(\*\/|\/\*\*?|\*|"""|'''|-->|<!--|#|\/\/)?$/;
  const clip = (t) => (t.length > 150 ? t.slice(0, 150) + "…" : t);
  let file = null;
  let removed = [];
  let added = [];
  const flush = () => {
    if (file && (removed.length || added.length)) {
      const { ext, categories } = classifyFile(file);
      const isCode = CODE_EXT.has(ext) && !categories.has("docs") && ext !== ".json" && !I18N_PATTERN.test(file);
      if (isCode) {
        const before = removed.map((t) => skeleton(file, t)).filter((t) => t && !DELIMITER.test(t));
        const after = added.map((t) => skeleton(file, t)).filter((t) => t && !DELIMITER.test(t));
        const changed = before.some((t) => !after.includes(t)) || after.some((t) => !before.includes(t));
        if (changed) {
          for (const t of removed) suspicious.push(file + ": -" + clip(t));
          for (const t of added) suspicious.push(file + ": +" + clip(t));
        }
      }
    }
    removed = [];
    added = [];
  };
  for (const line of patch.split("\n")) {
    const fm = /^\+\+\+ b\/(.+)$/.exec(line);
    if (fm) { flush(); file = fm[1]; continue; }
    if (/^@@ /.test(line)) { flush(); continue; }
    if (!file || /^(\+\+\+|---|diff |index )/.test(line)) continue;
    if (line[0] === "-") removed.push(line.slice(1));
    else if (line[0] === "+") added.push(line.slice(1));
  }
  flush();
  if (suspicious.length) {
    lines.push("## Changed hunks where code outside strings and comments also changed (" + suspicious.length + " lines)");
    lines.push("");
    lines.push("Confirm each is intentional (for example a re-wrapped string literal); revert anything that changed code.");
    lines.push("");
    lines.push("```diff");
    for (const t of suspicious.slice(0, 80)) lines.push(t);
    if (suspicious.length > 80) lines.push("… " + (suspicious.length - 80) + " more");
    lines.push("```");
    lines.push("");
  }

  const remaining = [];
  for (const f of after.files) for (const c of f.candidates) if (c.hits.length) remaining.push(`${f.file}:${c.line} [${KIND_LABEL[c.kind] ?? c.kind}] ${c.hits.map((h) => `${h.tell}: "${h.match}"`).join("; ")}`);
  if (remaining.length) {
    lines.push(`## Remaining lint hits (${remaining.length})`);
    lines.push("");
    lines.push("Each is either a false positive (state why in the report) or still to fix.");
    lines.push("");
    for (const r of remaining.slice(0, 120)) lines.push(`- ${r}`);
    if (remaining.length > 120) lines.push(`- … ${remaining.length - 120} more`);
    lines.push("");
  }
  lines.push(`Detail: \`${path.join(dir, "candidates.md")}\` (refreshed).`);
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Main

const opts = parseArgs(process.argv.slice(2));
const cwd = repoRoot();
const dir = outDir(cwd, opts.out);
fs.mkdirSync(dir, { recursive: true });
const invPath = path.join(dir, "inventory.json");

if (opts.check) {
  if (!fs.existsSync(invPath)) fail(`no inventory at ${invPath}; run gather.mjs first`);
  const before = JSON.parse(fs.readFileSync(invPath, "utf8"));
  const after = buildInventory(cwd, opts, before);
  fs.writeFileSync(path.join(dir, "candidates.md"), renderCandidates(after));
  fs.writeFileSync(path.join(dir, "inventory.after.json"), JSON.stringify(after, null, 2));
  process.stdout.write(renderCheck(cwd, before, after, dir));
} else {
  const inv = buildInventory(cwd, opts, null);
  inv.snapshot = snapshot(cwd);
  fs.writeFileSync(invPath, JSON.stringify(inv, null, 2));
  fs.writeFileSync(path.join(dir, "candidates.md"), renderCandidates(inv));
  const digest = renderDigest(inv, dir);
  fs.writeFileSync(path.join(dir, "digest.md"), digest);
  process.stdout.write(opts.json ? JSON.stringify(inv, null, 2) : digest);
}
