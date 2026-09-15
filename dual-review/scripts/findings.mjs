#!/usr/bin/env node
// dual-review — parse synthesis.md (and the raw reviews) into findings.json, anchoring each
// finding to a commentable diff line where possible.
//
//   findings.mjs <cacheDir>

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SEVERITIES = ["blocker", "major", "minor", "nit"];
export const SOURCES = ["confirmed", "disputed", "claude-only", "gpt-only", "already-raised"];
export const POSTED_MARKER = "<!-- dual-review -->";

function field(body, name) {
  return body.match(new RegExp(`^-\\s+${name}:\\s*(.*)$`, "im"))?.[1]?.trim() ?? "";
}

export function summaryText(markdown) {
  return markdown.match(/^##\s+Summary\s*\n([\s\S]*?)(?=\n##\s|$)/m)?.[1]?.trim() ?? "";
}

export function parseFindings(markdown) {
  return markdown
    .split(/^###\s+Finding:\s*/m)
    .slice(1)
    .map((block) => {
      const [title, ...bodyLines] = block.split("\n");
      const body = bodyLines.join("\n");
      const severity = field(body, "Severity").toLowerCase();
      const source = field(body, "Source").toLowerCase();
      return {
        title: (title ?? "").trim(),
        severity: SEVERITIES.includes(severity) ? severity : "unclassified",
        source: SOURCES.includes(source) ? source : "unknown",
        location: field(body, "Location").replace(/^`+|`+$/g, "").trim(),
        impact: field(body, "Impact"),
        recommendation: field(body, "Recommendation"),
      };
    });
}

export function locate(location) {
  const match = location.match(/^(.+?):(\d+)(?:-(\d+))?$/);
  if (!match) return null;
  const startLine = Number(match[2]);
  const line = Number(match[3] ?? match[2]);
  if (startLine < 1 || line < startLine) return null;
  return { file: match[1], line, startLine: line === startLine ? undefined : startLine };
}

export function buildDiffIndex(diff) {
  const index = new Map();
  let file = null;
  let newLine = 0;
  for (const line of diff.split("\n")) {
    const header = line.match(/^\+\+\+ (?:b\/)?(.+)$/);
    if (header) {
      file = header[1] === "/dev/null" ? null : header[1];
      continue;
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (file === null || line.startsWith("-")) continue;
    if (line.startsWith("+") || line.startsWith(" ")) {
      if (!index.has(file)) index.set(file, new Set());
      index.get(file).add(newLine);
      newLine += 1;
    }
  }
  return index;
}

function anchored(located, index) {
  const lines = index.get(located.file);
  if (!lines?.has(located.line)) return false;
  return located.startLine === undefined || lines.has(located.startLine);
}

function previouslyPosted(located, priorComments) {
  return priorComments.some(
    (comment) =>
      comment.body?.includes(POSTED_MARKER) && comment.file === located.file && comment.line === located.line,
  );
}

function count(items, key, keys) {
  const result = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const item of items) result[item[key]] = (result[item[key]] ?? 0) + 1;
  return result;
}

function reviewerSection(file, skippedFile) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) {
    const markdown = fs.readFileSync(file, "utf8");
    const findings = parseFindings(markdown);
    return {
      present: true,
      skipped: null,
      summary: summaryText(markdown),
      structured: findings.length > 0 || /No findings\./.test(markdown),
      findings,
    };
  }
  let skipped = null;
  if (skippedFile && fs.existsSync(skippedFile)) {
    try {
      skipped = JSON.parse(fs.readFileSync(skippedFile, "utf8"));
    } catch {
      skipped = { reason: "skipped" };
    }
  }
  return { present: false, skipped, summary: "", structured: false, findings: [] };
}

function main() {
  const cacheDir = process.argv[2] && path.resolve(process.argv[2]);
  if (!cacheDir) {
    console.error("usage: findings.mjs <cacheDir>");
    process.exit(2);
  }
  const meta = JSON.parse(fs.readFileSync(path.join(cacheDir, "meta.json"), "utf8"));
  if (!fs.existsSync(meta.paths.synthesis)) {
    console.error(`dual-review: ${meta.paths.synthesis} does not exist.`);
    process.exit(1);
  }
  const synthesis = fs.readFileSync(meta.paths.synthesis, "utf8");
  const diff = fs.readFileSync(meta.paths.diff, "utf8");
  let priorComments = [];
  try {
    priorComments = JSON.parse(fs.readFileSync(meta.paths.priorComments, "utf8"));
  } catch {}
  const index = buildDiffIndex(diff);

  const findings = parseFindings(synthesis).map((finding) => {
    const located = locate(finding.location);
    const isAnchored = located !== null && anchored(located, index);
    let bucket = "unanchored";
    let posted = false;
    if (finding.source === "already-raised") bucket = "already-raised";
    else if (isAnchored && previouslyPosted(located, priorComments)) {
      bucket = "already-raised";
      posted = true;
    } else if (isAnchored) bucket = "line";
    return {
      ...finding,
      file: located?.file ?? null,
      line: located?.line ?? null,
      startLine: located?.startLine ?? null,
      anchored: isAnchored,
      previouslyPosted: posted,
      bucket,
    };
  });

  const result = {
    generatedAt: new Date().toISOString(),
    summary: summaryText(synthesis),
    counts: {
      severity: count(findings, "severity", [...SEVERITIES, "unclassified"]),
      source: count(findings, "source", [...SOURCES, "unknown"]),
      bucket: count(findings, "bucket", ["line", "unanchored", "already-raised"]),
    },
    findings,
    reviewers: {
      claude: reviewerSection(meta.paths.claude, null),
      gpt: reviewerSection(meta.paths.opencode, meta.paths.opencodeSkipped),
    },
  };
  fs.writeFileSync(meta.paths.findings, JSON.stringify(result, null, 2));

  const sev = result.counts.severity;
  const src = result.counts.source;
  const bucket = result.counts.bucket;
  console.log(
    `${findings.length} finding(s): blocker ${sev.blocker}, major ${sev.major}, minor ${sev.minor}, nit ${sev.nit}${
      sev.unclassified ? `, unclassified ${sev.unclassified}` : ""
    }`,
  );
  console.log(
    `agreement: confirmed ${src.confirmed}, claude-only ${src["claude-only"]}, gpt-only ${src["gpt-only"]}, disputed ${src.disputed}, already-raised ${src["already-raised"]}`,
  );
  console.log(
    `posting: ${bucket.line} anchored to diff lines, ${bucket.unanchored} unanchored (carried in the review body), ${bucket["already-raised"]} skipped as already raised`,
  );
  if (!result.reviewers.gpt.present) {
    console.log(`gpt review: skipped${result.reviewers.gpt.skipped?.reason ? ` — ${result.reviewers.gpt.skipped.reason}` : ""}`);
  }
  console.log(`wrote ${meta.paths.findings}`);
}

function isEntryPoint() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) main();
