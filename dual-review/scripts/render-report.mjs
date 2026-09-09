#!/usr/bin/env node
// dual-review — render findings.json into report.html (the artifact page).
//
//   render-report.mjs <cacheDir>                    write report.html, print title + description
//   render-report.mjs <cacheDir> --save-url <url>   record the published artifact URL

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SEVERITIES } from "./findings.mjs";

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const cacheDir = argv[0] && !argv[0].startsWith("-") ? path.resolve(argv[0]) : null;
if (!cacheDir) {
  console.error("usage: render-report.mjs <cacheDir> [--save-url <url>]");
  process.exit(2);
}
const meta = JSON.parse(fs.readFileSync(path.join(cacheDir, "meta.json"), "utf8"));

const saveIndex = argv.indexOf("--save-url");
if (saveIndex !== -1) {
  const url = argv[saveIndex + 1];
  if (!url) {
    console.error("--save-url requires a URL");
    process.exit(2);
  }
  fs.writeFileSync(meta.paths.artifact, JSON.stringify({ url, savedAt: new Date().toISOString() }, null, 2));
  console.log(`Recorded artifact URL in ${meta.paths.artifact}`);
  process.exit(0);
}

const data = JSON.parse(fs.readFileSync(meta.paths.findings, "utf8"));
const template = fs.readFileSync(path.join(SKILL_DIR, "templates", "report.html"), "utf8");

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function inline(text) {
  return esc(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>");
}

// Minimal Markdown for the raw reviews: headings (demoted under the page's own), lists, paragraphs,
// fenced code, inline code/bold/italic. Everything is escaped first.
function markdown(source) {
  const out = [];
  let para = [];
  let list = null;
  let code = null;
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<ul>${list.map((item) => `<li>${inline(item)}</li>`).join("")}</ul>`);
    list = null;
  };
  for (const raw of source.replace(/\r\n/g, "\n").split("\n")) {
    if (raw.startsWith("```")) {
      if (code !== null) {
        out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
        code = null;
      } else {
        flushPara();
        flushList();
        code = [];
      }
      continue;
    }
    if (code !== null) {
      code.push(raw);
      continue;
    }
    const heading = raw.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushPara();
      flushList();
      const level = Math.min(heading[1].length + 2, 6);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    const item = raw.match(/^\s*[-*]\s+(.*)$/);
    if (item) {
      flushPara();
      (list ??= []).push(item[1]);
      continue;
    }
    if (!raw.trim()) {
      flushPara();
      flushList();
      continue;
    }
    flushList();
    para.push(raw.trim());
  }
  flushPara();
  flushList();
  if (code !== null) out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
  return out.join("\n");
}

const repoName = meta.repo ? meta.repo.split("/")[1] : path.basename(meta.repoRoot);
const isPr = meta.mode === "pr";
const title = isPr ? `${repoName} #${meta.prNumber} review` : `${repoName} ${meta.headRef} review`;
const description = data.summary.split(/(?<=\.)\s+/)[0] || `Dual review of ${title}`;
const canLink = Boolean(meta.repo) && meta.mode !== "working-tree";

function blobLink(finding) {
  if (!canLink || !finding.file) return null;
  const range = finding.startLine ? `L${finding.startLine}-L${finding.line}` : `L${finding.line}`;
  return `https://github.com/${meta.repo}/blob/${meta.headSha}/${finding.file}#${range}`;
}

function locationHtml(finding) {
  if (!finding.location || finding.location.toLowerCase() === "n/a") return "";
  const link = blobLink(finding);
  const text = esc(finding.location);
  return `<div class="loc">${link ? `<a href="${esc(link)}" target="_blank" rel="noopener">${text}</a>` : text}</div>`;
}

function findingHtml(finding, { showSource = true } = {}) {
  const src = showSource && finding.source !== "unknown" ? `<span class="badge src src-${esc(finding.source)}">${esc(finding.source.replace("-", " "))}</span>` : "";
  const rows = [
    finding.impact ? `<dt>Impact</dt><dd>${inline(finding.impact)}</dd>` : "",
    finding.recommendation ? `<dt>Recommendation</dt><dd>${inline(finding.recommendation)}</dd>` : "",
  ].join("");
  return `<li><article class="finding sev-${esc(finding.severity)}">
<header><span class="badge sev">${esc(finding.severity)}</span>${src}<h3>${inline(finding.title)}</h3></header>
${locationHtml(finding)}
${rows ? `<dl class="detail">${rows}</dl>` : ""}
</article></li>`;
}

function findingList(items, options) {
  return `<ol class="findings">${items.map((f) => findingHtml(f, options)).join("\n")}</ol>`;
}

// ---- header
const targetHtml = isPr
  ? `<a href="${esc(meta.prUrl)}" target="_blank" rel="noopener">#${meta.prNumber}</a>${meta.prTitle ? ` · ${esc(meta.prTitle)}` : ""}`
  : `<span class="mono">${esc(meta.headRef)}</span>${meta.mode === "working-tree" ? " · working tree" : ""}`;
const short = (sha) => (sha ? sha.slice(0, 7) : "—");
let gptUsage = null;
try {
  gptUsage = JSON.parse(fs.readFileSync(meta.paths.opencodeUsage, "utf8"));
} catch {}
const gptSkipped = data.reviewers.gpt.skipped;
const reviewersHtml = `Claude${meta.claudeModel ? ` (${esc(meta.claudeModel)})` : ""} · <span class="mono">${esc(meta.gptModel)}</span> via opencode${
  gptSkipped ? " (skipped)" : ""
}`;
const usageHtml = gptUsage
  ? `${(gptUsage.input / 1000).toFixed(1)}k in / ${(gptUsage.output / 1000).toFixed(1)}k out · ${gptUsage.elapsedSeconds}s`
  : null;
const generated = new Date(data.generatedAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });

const metaItems = [
  [isPr ? "Pull request" : "Target", targetHtml],
  ["Base → head", `<span class="mono">${esc(meta.baseRef)} @ ${short(meta.baseSha)} → ${esc(isPr ? meta.headRef : "")}${isPr ? " @ " : ""}${short(meta.headSha)}</span>`],
  ["Reviewers", reviewersHtml],
  ["Changed files", `${meta.changedFiles.length}${isPr && meta.priorCommentCount ? ` · ${meta.priorCommentCount} prior comment${meta.priorCommentCount === 1 ? "" : "s"}` : ""}`],
  ["Generated", esc(generated)],
  ...(usageHtml ? [["GPT usage", esc(usageHtml)]] : []),
];

// ---- tiles + agreement
const sev = data.counts.severity;
const src = data.counts.source;
const visible = data.findings.filter((f) => f.bucket !== "already-raised");
const alreadyRaised = data.findings.filter((f) => f.bucket === "already-raised");
const tiles = SEVERITIES.map(
  (s) => `<div class="tile sev-${s}${sev[s] ? "" : " zero"}"><div class="n">${sev[s]}</div><div class="l">${s}</div></div>`,
).join("");
const agreementItems = [
  ["confirmed by both", src.confirmed],
  ["Claude only", src["claude-only"]],
  ["GPT only", src["gpt-only"]],
  ["disputed", src.disputed],
  ["already raised", alreadyRaised.length],
]
  .filter(([, n]) => n > 0)
  .map(([label, n]) => `<li><b>${n}</b> ${label}</li>`)
  .join("");

// ---- sections
const sections = [...SEVERITIES, "unclassified"]
  .map((s) => ({ severity: s, items: visible.filter((f) => f.severity === s) }))
  .filter(({ items }) => items.length > 0)
  .map(
    ({ severity, items }) =>
      `<h2>${esc(severity)} <span class="count">${items.length}</span></h2>\n${findingList(items)}`,
  )
  .join("\n");

const emptyState =
  visible.length === 0
    ? `<h2>Findings <span class="count">0</span></h2><div class="empty">No findings cleared the bar${alreadyRaised.length ? ` beyond ${alreadyRaised.length} already raised on the PR` : ""}.</div>`
    : "";

const alreadyRaisedHtml = alreadyRaised.length
  ? `<details><summary>Already raised on the PR <span class="count">${alreadyRaised.length}</span></summary><div class="details-body">${findingList(alreadyRaised, { showSource: false })}</div></details>`
  : "";

function reviewerDetails(label, reviewer, file) {
  if (!reviewer.present) {
    return `<details><summary>${esc(label)} <span class="count">skipped</span></summary><div class="details-body"><p class="md">${esc(reviewer.skipped?.reason ?? "The review did not run.")}</p></div></details>`;
  }
  const raw = fs.readFileSync(file, "utf8");
  const count = reviewer.structured ? `${reviewer.findings.length} finding${reviewer.findings.length === 1 ? "" : "s"}` : "raw";
  return `<details><summary>${esc(label)} <span class="count">${count}</span></summary><div class="details-body"><div class="md">${markdown(raw)}</div></div></details>`;
}

const rawReviews = [
  reviewerDetails("Claude review", data.reviewers.claude, meta.paths.claude),
  reviewerDetails(`GPT review · ${meta.gptModel}`, data.reviewers.gpt, meta.paths.opencode),
].join("\n");

const filesHtml = `<details><summary>Changed files <span class="count">${meta.changedFiles.length}</span></summary><div class="details-body"><ul class="files">${meta.changedFiles
  .map((f) => `<li>${esc(f)}</li>`)
  .join("")}</ul></div></details>`;

const content = `
<header>
  <div class="eyebrow">Dual review · ${esc(meta.mode === "pr" ? "pull request" : meta.mode === "working-tree" ? "working tree" : "branch")}</div>
  <h1>${esc(repoName)} ${isPr ? `<span class="num">#${meta.prNumber}</span>` : `<span class="num mono">${esc(meta.headRef)}</span>`}${
    isPr && meta.prTitle ? `<span class="title-sub">${esc(meta.prTitle)}</span>` : ""
  }</h1>
  <dl class="meta">${metaItems.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("")}</dl>
  ${gptSkipped ? `<div class="notice">GPT review skipped — ${esc(gptSkipped.reason ?? "unknown reason")}. This synthesis is Claude-only.</div>` : ""}
</header>
<p class="summary">${inline(data.summary || "No summary was produced.")}</p>
<div class="tiles">${tiles}</div>
${agreementItems ? `<ul class="agreement">${agreementItems}</ul>` : ""}
${sections}
${emptyState}
${alreadyRaisedHtml ? `<h2>Context</h2>${alreadyRaisedHtml}` : "<h2>Context</h2>"}
${rawReviews}
${filesHtml}
<footer class="foot">Artifacts: <code>${esc(meta.cacheDir)}</code><br>Rerun with <code>/dual-review${isPr ? ` ${meta.prNumber}` : ""} --force</code> to refresh both reviews.</footer>
`;

const html = template.replace("{{TITLE}}", esc(title)).replace("{{CONTENT}}", content);
fs.writeFileSync(meta.paths.report, html);
console.log(JSON.stringify({ report: meta.paths.report, title, description }, null, 2));
