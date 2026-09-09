#!/usr/bin/env node
// dual-review — run the GPT review through opencode and write opencode.md.
//
//   run-opencode.mjs <cacheDir> [--model <id>] [--timeout <minutes>] [--bin <opencode>]
//
// Never exits non-zero for a reviewer failure: it writes opencode.skipped.json instead so the
// pipeline continues Claude-only.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

function usageExit() {
  console.error("usage: run-opencode.mjs <cacheDir> [--model <id>] [--timeout <minutes>] [--bin <opencode>]");
  process.exit(2);
}

const argv = process.argv.slice(2);
const cacheDir = argv[0] && !argv[0].startsWith("-") ? path.resolve(argv[0]) : usageExit();
let modelOverride = null;
let timeoutMinutes = 20;
let bin = "opencode";
for (let i = 1; i < argv.length; i += 1) {
  const value = () => argv[++i] ?? usageExit();
  if (argv[i] === "--model") modelOverride = value();
  else if (argv[i] === "--timeout") timeoutMinutes = Number(value());
  else if (argv[i] === "--bin") bin = value();
  else usageExit();
}

const meta = JSON.parse(fs.readFileSync(path.join(cacheDir, "meta.json"), "utf8"));
const model = modelOverride ?? meta.gptModel;
const prompt = fs.readFileSync(meta.paths.reviewerPrompt, "utf8");
const startedAt = Date.now();
const log = [];

function note(line) {
  log.push(`${new Date().toISOString()} ${line}`);
  console.log(`[opencode] ${line}`);
}

function finish() {
  fs.writeFileSync(meta.paths.opencodeLog, `${log.join("\n")}\n`);
}

function skip(reason) {
  fs.rmSync(meta.paths.opencode, { force: true });
  fs.writeFileSync(
    meta.paths.opencodeSkipped,
    JSON.stringify({ reason, model, at: new Date().toISOString() }, null, 2),
  );
  note(`skipped — ${reason}`);
  finish();
  process.exit(0);
}

fs.rmSync(meta.paths.opencode, { force: true });
fs.rmSync(meta.paths.opencodeSkipped, { force: true });

// opencode configs reference provider keys as {env:NAME}. Interactive shells export those from rc
// files that a non-interactive runner never sources. When any such variable is missing here, run
// opencode through the user's shell with the rc sourced, so it inherits the same environment as
// their terminal. This script never reads the values itself.
function missingConfigEnv() {
  const home = process.env.HOME ?? "";
  const configFiles = [
    path.join(home, ".config", "opencode", "opencode.jsonc"),
    path.join(home, ".config", "opencode", "opencode.json"),
    path.join(meta.repoRoot, "opencode.jsonc"),
    path.join(meta.repoRoot, "opencode.json"),
  ];
  const names = new Set();
  for (const file of configFiles) {
    try {
      for (const match of fs.readFileSync(file, "utf8").matchAll(/\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
        names.add(match[1]);
      }
    } catch {}
  }
  return [...names].filter((name) => !process.env[name]);
}

function launch(command, commandArgs) {
  const options = { cwd: meta.reviewCwd, stdio: ["pipe", "pipe", "pipe"] };
  const missing = missingConfigEnv();
  const shell = process.env.SHELL ?? "";
  const rc = shell.endsWith("zsh") ? "~/.zshrc" : shell.endsWith("bash") ? "~/.bashrc" : null;
  if (missing.length === 0 || !rc || process.platform === "win32") return spawn(command, commandArgs, options);
  note(`${missing.join(", ")} not set in this environment; running under ${shell} with ${rc} sourced`);
  const quoted = [command, ...commandArgs].map((arg) => `'${arg.replaceAll("'", `'\\''`)}'`).join(" ");
  return spawn(shell, ["-c", `source ${rc} >/dev/null 2>&1; exec ${quoted}`], options);
}

const args = ["run", "--format", "json", "--agent", "plan", "--auto", "-m", model];
note(`starting ${bin} ${args.join(" ")} in ${meta.reviewCwd}`);

const child = launch(bin, args);
let spawnError = null;
let stderr = "";
let eventError = "";
let timedOut = false;
let messageId = "";
let messageText = [];
const usage = { input: 0, output: 0 };

const timer = setTimeout(() => {
  timedOut = true;
  child.kill("SIGTERM");
}, timeoutMinutes * 60 * 1000);

child.on("error", (error) => {
  spawnError = error;
});
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});
child.stdin.on("error", () => {});
child.stdin.end(prompt);

readline.createInterface({ input: child.stdout }).on("line", (line) => {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }
  const part = event?.part;
  if (event?.type === "error") {
    eventError = event.error?.data?.message ?? event.error?.name ?? "unknown error";
    note(`error event: ${eventError}`);
  } else if (event?.type === "tool_use" && part?.tool) {
    note(`tool: ${part.tool}`);
  } else if (event?.type === "step_finish" && part?.tokens) {
    usage.input += (part.tokens.input ?? 0) + (part.tokens.cache?.read ?? 0) + (part.tokens.cache?.write ?? 0);
    usage.output += part.tokens.output ?? 0;
  } else if (event?.type === "text" && typeof part?.text === "string") {
    if (part.messageID !== messageId) {
      messageId = part.messageID ?? "";
      messageText = [];
    }
    messageText.push(part.text);
  }
});

child.on("close", (code) => {
  clearTimeout(timer);
  const elapsedSeconds = Math.round((Date.now() - startedAt) / 100) / 10;
  const finalText = messageText.join("\n").trim();
  if (spawnError?.code === "ENOENT" || code === 127) skip(`${bin} CLI not found on PATH`);
  if (timedOut) skip(`timed out after ${timeoutMinutes} minutes`);
  if (code !== 0 || !finalText) {
    const detail = eventError || stderr.trim().split("\n").slice(-5).join("\n") || (code === 0 ? "no final response" : `exit code ${code}`);
    skip(detail);
  }
  fs.writeFileSync(meta.paths.opencode, `${finalText}\n`);
  fs.writeFileSync(
    meta.paths.opencodeUsage,
    JSON.stringify({ model, input: usage.input, output: usage.output, elapsedSeconds }, null, 2),
  );
  note(`done in ${elapsedSeconds}s — ${usage.input} tokens in / ${usage.output} out → ${meta.paths.opencode}`);
  finish();
});
