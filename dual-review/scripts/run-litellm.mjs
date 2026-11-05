#!/usr/bin/env node
// dual-review — run the GPT review through a LiteLLM proxy and write gpt.md. Use it where opencode
// is not installed, for example in a Claude Code cloud session.
//
//   run-litellm.mjs <cacheDir> [--model <id>] [--timeout <minutes>] [--max-steps <n>]
//
// Environment:
//   LITELLM_BASE_URL  the proxy URL, for example https://litellm.example.com (required)
//   LITELLM_API_KEY   the virtual key, sent as a bearer token. Leave it unset when a cloud
//                     environment attaches the key as a network secret.
//
// The model gets read-only tools over the checkout under review, through the OpenAI-compatible
// chat completions API. Never exits non-zero for a reviewer failure: it writes gpt.skipped.json
// instead so the pipeline continues Claude-only.

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Node's fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY is set at startup (Node >= 22.21).
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const result = spawnSync(
    process.execPath,
    ["--disable-warning=UNDICI-EHPA", fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: "inherit", env: { ...process.env, NODE_USE_ENV_PROXY: "1" } },
  );
  process.exit(result.status ?? 1);
}

function usageExit() {
  console.error("usage: run-litellm.mjs <cacheDir> [--model <id>] [--timeout <minutes>] [--max-steps <n>]");
  process.exit(2);
}

const argv = process.argv.slice(2);
const cacheDir = argv[0] && !argv[0].startsWith("-") ? path.resolve(argv[0]) : usageExit();
let modelOverride = null;
let timeoutMinutes = 20;
let maxSteps = 40;
for (let i = 1; i < argv.length; i += 1) {
  const value = () => argv[++i] ?? usageExit();
  if (argv[i] === "--model") modelOverride = value();
  else if (argv[i] === "--timeout") timeoutMinutes = Number(value());
  else if (argv[i] === "--max-steps") maxSteps = Number(value());
  else usageExit();
}

const meta = JSON.parse(fs.readFileSync(path.join(cacheDir, "meta.json"), "utf8"));
// The default model id is in opencode form, <provider>/<model>. LiteLLM wants the part after the
// "litellm/" provider prefix.
const model = (modelOverride ?? meta.gptModel).replace(/^litellm\//, "");
const prompt = fs.readFileSync(meta.paths.reviewerPrompt, "utf8");
const request = fs.readFileSync(meta.paths.request, "utf8");
const startedAt = Date.now();
const log = [];

function note(line) {
  log.push(`${new Date().toISOString()} ${line}`);
  console.log(`[litellm] ${line}`);
}

function finish() {
  fs.writeFileSync(meta.paths.gptLog, `${log.join("\n")}\n`);
}

function skip(reason) {
  fs.rmSync(meta.paths.gpt, { force: true });
  fs.writeFileSync(
    meta.paths.gptSkipped,
    JSON.stringify({ reason, model, backend: "litellm", at: new Date().toISOString() }, null, 2),
  );
  note(`skipped — ${reason}`);
  finish();
  process.exit(0);
}

fs.rmSync(meta.paths.gpt, { force: true });
fs.rmSync(meta.paths.gptSkipped, { force: true });

const baseUrl = (process.env.LITELLM_BASE_URL ?? "").trim().replace(/\/+$/, "");
const apiKey = (process.env.LITELLM_API_KEY ?? "").trim();
if (!baseUrl) skip("LITELLM_BASE_URL is not set");
const endpoint = `${baseUrl}${/\/v1$/.test(baseUrl) ? "" : "/v1"}/chat/completions`;
const host = (() => {
  try {
    return new URL(endpoint).host;
  } catch {
    return skip(`LITELLM_BASE_URL is not a valid URL: ${baseUrl}`);
  }
})();

// ---------------------------------------------------------------- read-only tools

const root = fs.realpathSync(meta.reviewCwd);
const requestFile = fs.realpathSync(meta.paths.request);
const MAX_LINES = 2000;
const MAX_CHARS = 100_000;
const MAX_LIST = 30_000;

function isInside(file, dir) {
  const relative = path.relative(dir, file);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

// The cache directory holds the Claude review, which this reviewer must not see.
function resolveReadable(requested) {
  let real;
  try {
    real = fs.realpathSync(path.resolve(root, String(requested ?? "")));
  } catch {
    throw new Error(`no such file: ${requested}`);
  }
  if (real === requestFile) return real;
  const parts = path.relative(root, real).split(path.sep);
  if (!isInside(real, root) || parts.includes(".dual-review") || parts.includes(".git")) {
    throw new Error(`${requested} is outside the repository under review`);
  }
  return real;
}

function truncate(text, limit) {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n… output truncated at ${limit} characters`;
}

function readFile({ path: file, offset = 1, limit = 400 }) {
  const real = resolveReadable(file);
  if (fs.statSync(real).isDirectory()) throw new Error(`${file} is a directory; use list_files`);
  const content = fs.readFileSync(real);
  if (content.subarray(0, 8000).includes(0)) return `${file} is a binary file.`;
  const lines = content.toString("utf8").split("\n");
  const start = Math.max(1, Math.floor(Number(offset) || 1));
  const count = Math.min(MAX_LINES, Math.max(1, Math.floor(Number(limit) || 400)));
  const slice = lines.slice(start - 1, start - 1 + count);
  const body = slice.map((line, index) => `${String(start + index).padStart(6)}  ${line}`).join("\n");
  const end = start + slice.length - 1;
  const more = end < lines.length ? `\n… lines ${end + 1}-${lines.length} not shown; pass offset to read on` : "";
  return truncate(`${body}${more}`, MAX_CHARS) || `${file} is empty.`;
}

function git(args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    if (error.status === 1 && !String(error.stderr ?? "").trim()) return "";
    throw new Error(String(error.stderr ?? error.message).trim());
  }
}

const EXCLUDE = [":(exclude).dual-review", ":(exclude,glob)**/.dual-review/**"];

function grep({ pattern, path: pathspec, ignore_case: ignoreCase = false }) {
  const args = ["grep", "-n", "-I", "--untracked", "-E", ...(ignoreCase ? ["-i"] : []), "-e", String(pattern)];
  const out = git([...args, "--", ...(pathspec ? [String(pathspec)] : []), ...EXCLUDE]);
  const lines = out.split("\n").filter(Boolean).map((line) => (line.length > 400 ? `${line.slice(0, 400)}…` : line));
  if (lines.length === 0) return "No matches.";
  const shown = lines.slice(0, 300);
  const more = lines.length > shown.length ? `\n… ${lines.length - shown.length} more matches; narrow the pattern or path` : "";
  return truncate(`${shown.join("\n")}${more}`, MAX_LIST);
}

function listFiles({ pathspec }) {
  const out = git(["ls-files", "--cached", "--others", "--exclude-standard", "--", ...(pathspec ? [String(pathspec)] : []), ...EXCLUDE]);
  const files = out.split("\n").filter(Boolean);
  if (files.length === 0) return "No files.";
  const shown = files.slice(0, 1000);
  const more = files.length > shown.length ? `\n… ${files.length - shown.length} more files; narrow the pathspec` : "";
  return truncate(`${shown.join("\n")}${more}`, MAX_LIST);
}

const HANDLERS = { read_file: readFile, grep, list_files: listFiles };

const TOOLS = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a text file from the repository under review. Returns numbered lines.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to the repository root." },
          offset: { type: "integer", description: "First line to return, 1-based. Default 1." },
          limit: { type: "integer", description: `Number of lines to return. Default 400, maximum ${MAX_LINES}.` },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "grep",
      description:
        "Search the repository under review with an extended regular expression (git grep -E). Returns path:line:text for each match.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Extended regular expression." },
          path: { type: "string", description: "Optional git pathspec to limit the search, such as 'src/' or '*.ts'." },
          ignore_case: { type: "boolean", description: "Match without regard to case. Default false." },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List the files in the repository under review, tracked and untracked, excluding ignored files.",
      parameters: {
        type: "object",
        properties: {
          pathspec: { type: "string", description: "Optional git pathspec, such as 'api/src/' or '*.graphql'." },
        },
      },
    },
  },
];

function runTool(call) {
  const name = call.function?.name ?? "";
  let args = {};
  try {
    args = JSON.parse(call.function?.arguments || "{}");
  } catch {
    return `Error: the arguments for ${name} are not valid JSON.`;
  }
  note(`tool: ${name} ${JSON.stringify(args)}`);
  const handler = HANDLERS[name];
  if (!handler) return `Error: there is no tool named ${name}.`;
  try {
    return handler(args);
  } catch (error) {
    return `Error: ${error.message}`;
  }
}

// ---------------------------------------------------------------- API

const deadline = AbortSignal.timeout(timeoutMinutes * 60 * 1000);
const usage = { input: 0, output: 0 };

function describeNetworkError(error) {
  if (deadline.aborted) return `timed out after ${timeoutMinutes} minutes`;
  const cause = error.cause?.message ?? error.cause?.code ?? error.message;
  return `could not reach ${host} (${cause}). In a Claude Code cloud session, allow ${host} in the environment's network access settings, or add a network secret for it.`;
}

async function complete(body) {
  const headers = { "content-type": "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  for (let attempt = 1; ; attempt += 1) {
    let response;
    try {
      response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body), signal: deadline });
    } catch (error) {
      if (deadline.aborted || attempt >= 4) throw new Error(describeNetworkError(error));
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
      continue;
    }
    const text = await response.text();
    if (response.ok) return JSON.parse(text);
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    if (retryable && attempt < 4) {
      const wait = Number(response.headers.get("retry-after")) || 2 ** attempt;
      note(`HTTP ${response.status}; retrying in ${wait}s`);
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
      continue;
    }
    let detail = text.trim().slice(0, 500);
    try {
      const parsed = JSON.parse(text);
      detail = parsed.error?.message ?? parsed.detail ?? detail;
    } catch {}
    detail = String(detail).replace(/\.+$/, "");
    if (response.status === 401 || response.status === 403) {
      const hint = apiKey ? "check LITELLM_API_KEY" : `LITELLM_API_KEY is not set and no network secret supplied a key for ${host}`;
      throw new Error(`LiteLLM rejected the request (HTTP ${response.status}): ${detail}. ${hint}.`);
    }
    throw new Error(`LiteLLM returned HTTP ${response.status}: ${detail}`);
  }
}

const SYSTEM = `You have three read-only tools over the repository under review: read_file, grep and list_files. Paths are relative to the repository root, which is checked out at the revision under review. Use the tools when the diff alone does not give enough context. When the review is complete, reply with the review Markdown only.`;

const messages = [
  { role: "system", content: SYSTEM },
  {
    role: "user",
    content: `${prompt.trimEnd()}\n\nThe content of the request file follows, so you do not need to read it.\n\n<review-request>\n${request.trimEnd()}\n</review-request>\n`,
  },
];

note(`starting ${model} at ${endpoint} in ${meta.reviewCwd}${apiKey ? "" : " (no LITELLM_API_KEY; relying on a network secret)"}`);

let finalText = "";
try {
  for (let step = 0; ; step += 1) {
    const budgetSpent = step >= maxSteps;
    if (budgetSpent) {
      messages.push({ role: "user", content: "The tool budget is spent. Write the complete review now, without tool calls." });
    }
    const data = await complete({ model, messages, tools: TOOLS, tool_choice: budgetSpent ? "none" : "auto" });
    usage.input += data.usage?.prompt_tokens ?? 0;
    usage.output += data.usage?.completion_tokens ?? 0;
    const choice = data.choices?.[0];
    const message = choice?.message ?? {};
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (calls.length > 0 && !budgetSpent) {
      messages.push({ role: "assistant", content: message.content ?? null, tool_calls: calls });
      for (const call of calls) messages.push({ role: "tool", tool_call_id: call.id, content: runTool(call) });
      continue;
    }
    finalText = (typeof message.content === "string" ? message.content : "").trim();
    if (!finalText) skip(choice?.finish_reason === "length" ? "the response was cut off at the output token limit" : "no final response");
    break;
  }
} catch (error) {
  skip(error.message);
}

const elapsedSeconds = Math.round((Date.now() - startedAt) / 100) / 10;
fs.writeFileSync(meta.paths.gpt, `${finalText}\n`);
fs.writeFileSync(
  meta.paths.gptUsage,
  JSON.stringify({ model, backend: "litellm", input: usage.input, output: usage.output, elapsedSeconds }, null, 2),
);
note(`done in ${elapsedSeconds}s — ${usage.input} tokens in / ${usage.output} out → ${meta.paths.gpt}`);
finish();
