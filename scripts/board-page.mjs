import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

// Usage: node scripts/board-page.mjs <repo-root> <out.html>
const [repo, out] = process.argv.slice(2);
const dir = join(repo, "tasks");
const board = JSON.parse(readFileSync(join(dir, "board.json"), "utf8"));

const bodies = {};
for (const f of readdirSync(dir).filter((f) => /^T\d+.*\.md$/.test(f))) {
	const text = readFileSync(join(dir, f), "utf8").replace(/^---[\s\S]*?---\n/, "");
	const id = f.slice(0, 4);
	// Drop the H1 (shown in the drawer header) and render the rest.
	bodies[id] = marked.parse(text.replace(/^\s*# .*\n/, ""), { gfm: true });
}

const tasks = Object.values(board.tasks).map((t) => ({
	id: t.id, title: t.title, phase: t.phase, pkg: t.package, edition: t.edition, model: t.model,
	size: t.size, deps: t.depends_on, unblocks: t.unblocks, spec: t.spec, column: t.column, file: t.file,
	html: bodies[t.id],
}));

const phases = [
	{ n: 0, name: "Foundations & spikes", exit: "Gates, harnesses and spike answers recorded" },
	{ n: 1, name: "Shared modules & e-sign MVP", exit: "Send → sign → download → verify; audit chain verifies" },
	{ n: 2, name: "Events MVP (free)", exit: "100 concurrent checkouts never oversell; times right in 3 zones" },
	{ n: 3, name: "Integration & suite", exit: "No waiver booking confirms without receipts; closed tab reconciles" },
	{ n: 4, name: "Payments & Pro", exit: "Paid journey, expired sessions release holds, replay idempotent" },
	{ n: 5, name: "Events advanced", exit: "Every Events requirement has a passing test" },
	{ n: 6, name: "E-sign advanced", exit: "Multi-party contract and PDF template journeys pass" },
	{ n: 7, name: "Hardening & 1.0", exit: "Security, accessibility, docs, release automation; contracts frozen" },
];

const data = { tasks, phases, criticalPath: board.criticalPath, columns: board.columns };
const json = JSON.stringify(data).replace(/</g, "\\u003c");

const html = `<title>semics Build Board</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;600&display=swap">
<style>
/* Layout: summary band, phase strip, critical path, filterable kanban; task detail in a side drawer (full-screen on phones) */
:root {
  --bg: #f4f6f8; --surface: #ffffff; --sunk: #eaeef2; --fg: #17202b; --muted: #5b6776; --line: #d9e0e7;
  --accent: #0f6e8c; --accent-soft: #dcf0f6;
  --opus: #5a3fc0; --opus-soft: #ece7fb; --sonnet: #0b7a5c; --sonnet-soft: #dcf3ea;
  --pro: #9a5b00; --pro-soft: #fbeedb; --ok: #2e7d32; --ok-soft: #e3f3e4; --warn: #a15c00; --warn-soft: #fdf1df; --bad: #b42318; --bad-soft: #fdecea;
  --f-sans: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  --f-mono: "IBM Plex Mono", ui-monospace, Menlo, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #10151b; --surface: #171e26; --sunk: #1d2630; --fg: #e4e9ef; --muted: #98a4b3; --line: #2a3542;
  --accent: #5cc3e0; --accent-soft: #15303a;
  --opus: #b3a2ff; --opus-soft: #2a2347; --sonnet: #6fd6b2; --sonnet-soft: #173229;
  --pro: #f0b35a; --pro-soft: #36290f; --ok: #7fce83; --ok-soft: #173019; --warn: #f0b35a; --warn-soft: #36290f; --bad: #ff8a7a; --bad-soft: #3a1d1a;
  color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #10151b; --surface: #171e26; --sunk: #1d2630; --fg: #e4e9ef; --muted: #98a4b3; --line: #2a3542;
  --accent: #5cc3e0; --accent-soft: #15303a;
  --opus: #b3a2ff; --opus-soft: #2a2347; --sonnet: #6fd6b2; --sonnet-soft: #173229;
  --pro: #f0b35a; --pro-soft: #36290f; --ok: #7fce83; --ok-soft: #173019; --warn: #f0b35a; --warn-soft: #36290f; --bad: #ff8a7a; --bad-soft: #3a1d1a;
  color-scheme: dark; }
* { box-sizing: border-box; }
body { background: var(--bg); color: var(--fg); font-family: var(--f-sans); font-size: 15px; line-height: 1.5; }
.wrap { max-width: 1240px; margin: 0 auto; padding-inline: 16px; padding-block: 20px 64px; display: grid; gap: 28px; }
h1, h2, h3 { margin: 0; line-height: 1.2; text-wrap: balance; }
h1 { font-size: clamp(1.6rem, 4vw, 2.2rem); font-weight: 700; letter-spacing: -0.01em; }
h2 { font-size: 1.15rem; font-weight: 600; }
.eyebrow { font: 600 .72rem var(--f-mono); letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.lede { margin: 6px 0 0; color: var(--muted); max-width: 70ch; }
header.top { display: grid; gap: 6px; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
.stat { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; display: grid; gap: 2px; }
.stat b { font: 600 1.5rem var(--f-mono); font-variant-numeric: tabular-nums; }
.stat span { color: var(--muted); font-size: .82rem; }
.chip { display: inline-flex; align-items: center; gap: 4px; font: 600 .7rem var(--f-mono); letter-spacing: .03em; padding: 2px 7px; border-radius: 999px; white-space: nowrap; }
.chip.opus { color: var(--opus); background: var(--opus-soft); }
.chip.sonnet { color: var(--sonnet); background: var(--sonnet-soft); }
.chip.pro { color: var(--pro); background: var(--pro-soft); }
.chip.size { color: var(--muted); background: var(--sunk); }
.chip.crit { color: var(--bad); background: var(--bad-soft); }
.phases { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
.phase { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; display: grid; gap: 6px; cursor: pointer; text-align: left; font: inherit; color: inherit; }
.phase[aria-pressed="true"] { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
.phase .num { font: 600 .72rem var(--f-mono); color: var(--accent); }
.phase .name { font-weight: 600; }
.phase .exit { font-size: .82rem; color: var(--muted); }
.phase .bar { display: flex; height: 6px; border-radius: 3px; overflow: hidden; background: var(--sunk); }
.phase .bar i { display: block; height: 100%; }
.phase .meta { display: flex; gap: 6px; flex-wrap: wrap; font-size: .75rem; color: var(--muted); }
.crit-path { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 14px; overflow-x: auto; }
.crit-path ol { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px 4px; align-items: center; }
.crit-path li { display: contents; }
.crit-path button { font: 600 .78rem var(--f-mono); border: 1px solid var(--line); background: var(--sunk); color: var(--fg); border-radius: 6px; padding: 4px 8px; cursor: pointer; }
.crit-path .arrow { color: var(--muted); font-size: .8rem; }
.filters { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.filters input, .filters select { font: inherit; font-size: .9rem; padding: 7px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--fg); min-width: 0; }
.filters input { flex: 1 1 220px; }
.board { display: grid; grid-template-columns: repeat(6, minmax(250px, 1fr)); gap: 12px; overflow-x: auto; padding-bottom: 8px; align-items: start; }
@media (max-width: 760px) { .board { grid-template-columns: 1fr; overflow-x: visible; } }
.col { background: var(--sunk); border-radius: 10px; padding: 10px; display: grid; gap: 8px; min-width: 0; align-content: start; }
.col h3 { font-size: .85rem; font-weight: 600; display: flex; justify-content: space-between; align-items: center; padding: 2px 4px 4px; }
.col h3 .count { font: 600 .75rem var(--f-mono); color: var(--muted); }
.col[data-col="ready"] h3 { color: var(--ok); }
.col[data-col="blocked"] h3 { color: var(--bad); }
.group-label { font: 600 .7rem var(--f-mono); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); padding: 6px 4px 0; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 10px 11px; display: grid; gap: 7px; cursor: pointer; text-align: left; font: inherit; color: inherit; width: 100%; }
.card:hover, .card:focus-visible { border-color: var(--accent); outline: none; }
.card .row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.card .id { font: 600 .75rem var(--f-mono); color: var(--accent); }
.card .t { font-size: .88rem; font-weight: 500; line-height: 1.35; }
.card .deps { font: .7rem var(--f-mono); color: var(--muted); }
.empty { font-size: .8rem; color: var(--muted); padding: 4px; }
.rules { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; }
.rule { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px; }
.rule h3 { font-size: .95rem; margin-bottom: 8px; }
.rule ol, .rule ul { margin: 0; padding-left: 1.2rem; display: grid; gap: 4px; font-size: .88rem; }
.drawer-bg { position: fixed; inset: 0; background: rgba(10, 15, 20, .45); z-index: 20; }
.drawer { position: fixed; top: 0; right: 0; bottom: 0; width: min(640px, 100%); background: var(--surface); z-index: 21; overflow-y: auto; padding: calc(env(safe-area-inset-top, 0px) + 16px) 20px calc(env(safe-area-inset-bottom, 0px) + 32px); border-left: 1px solid var(--line); }
.drawer .head { display: grid; gap: 8px; padding-bottom: 12px; border-bottom: 1px solid var(--line); margin-bottom: 12px; }
.drawer .close { justify-self: end; font: 600 .85rem var(--f-sans); border: 1px solid var(--line); background: var(--sunk); color: var(--fg); border-radius: 6px; padding: 6px 12px; cursor: pointer; }
.drawer h2 { font-size: 1.25rem; }
.drawer .body h2 { font-size: 1rem; margin: 18px 0 6px; }
.drawer .body p, .drawer .body li { font-size: .92rem; }
.drawer .body ul { padding-left: 1.2rem; }
.drawer .body li input { margin-right: 6px; }
.drawer code { font-family: var(--f-mono); font-size: .82em; background: var(--sunk); padding: .05em .3em; border-radius: 4px; overflow-wrap: anywhere; }
.drawer pre { background: var(--sunk); border-radius: 6px; padding: 10px 12px; overflow-x: auto; }
.drawer pre code { background: none; padding: 0; }
.tree { font: .82rem var(--f-mono); display: grid; gap: 3px; margin: 6px 0 0; padding: 0; list-style: none; }
.tree li { display: flex; gap: 6px; align-items: baseline; }
.tree button { font: inherit; background: none; border: 0; color: var(--accent); cursor: pointer; padding: 0; text-align: left; }
.tree .st { font-size: .7rem; color: var(--muted); }
.links { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
@media (max-width: 560px) { .links { grid-template-columns: 1fr; } }
.links h3 { font-size: .8rem; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: .06em; }
button:focus-visible, select:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.note { background: var(--accent-soft); border-radius: 8px; padding: 12px 14px; font-size: .9rem; }
</style>

<div class="wrap">
  <header class="top">
    <span class="eyebrow">semics-uk / emdash-plugins · build plan for review · 10 Oct 2026</span>
    <h1>semics Build Board</h1>
    <p class="lede">93 test-first tasks across 8 phases for the Events and E-sign plugins. Each task has its definition, the tests to write first, acceptance criteria, verify commands, dependencies and an assigned model. Tap any task for the full card.</p>
  </header>

  <section class="stats" id="stats" aria-label="Summary"></section>

  <section aria-labelledby="ph-h" style="display:grid;gap:10px">
    <h2 id="ph-h">Phases</h2>
    <div class="phases" id="phases"></div>
  </section>

  <section class="crit-path" aria-labelledby="cp-h">
    <h2 id="cp-h">Critical path</h2>
    <p class="lede" style="margin-top:4px">The longest chain of dependent work, weighted by size (S = 1, M = 2, L = 3). Delays here delay 1.0.</p>
    <ol id="cp"></ol>
  </section>

  <section aria-labelledby="bd-h" style="display:grid;gap:12px">
    <h2 id="bd-h">Board</h2>
    <div class="filters">
      <label class="sr" for="q" hidden>Search</label>
      <input id="q" type="search" placeholder="Search tasks, packages or requirement IDs" aria-label="Search tasks">
      <select id="f-phase" aria-label="Phase"><option value="">All phases</option></select>
      <select id="f-model" aria-label="Model"><option value="">Both models</option><option value="opus-5.5">Opus 5.5</option><option value="sonnet-5.5">Sonnet 5.5</option></select>
      <select id="f-edition" aria-label="Edition"><option value="">Free and Pro</option><option value="free">Free</option><option value="pro">Pro</option></select>
      <select id="f-pkg" aria-label="Package"><option value="">All packages</option></select>
    </div>
    <div class="board" id="board"></div>
  </section>

  <section aria-labelledby="st-h" style="display:grid;gap:12px">
    <h2 id="st-h">Standards every task follows</h2>
    <div class="rules">
      <div class="rule"><h3>Test-driven, in three commits</h3><ol>
        <li><b>Red:</b> write the task's listed tests; see them fail for the right reason.</li>
        <li><b>Green:</b> the smallest implementation that passes.</li>
        <li><b>Refactor</b> with tests green. Every later bug gets a failing test first.</li></ol></div>
      <div class="rule"><h3>Self-verifying</h3><ul>
        <li>One command, <code>pnpm verify</code>: lint, typecheck, tests with coverage, manifest validation, builds, board check.</li>
        <li>Every route and job asserts its platform budget (≤ 10 calls, CPU ceiling).</li>
        <li>Public routes always test bad input, bad token, rate limit and data leakage.</li></ul></div>
      <div class="rule"><h3>Modular</h3><ul>
        <li>Pure domain logic in <code>src/domain</code>; routes are thin adapters.</li>
        <li>Shared helpers never import a product; e-sign never imports events.</li>
        <li>UI code only talks to its core through public routes.</li></ul></div>
      <div class="rule"><h3>Model assignment</h3><ul>
        <li><b>Opus 5.5:</b> concurrency, cryptography, money paths, platform limits, sanitising, orchestration, phase-gate reviews.</li>
        <li><b>Sonnet 5.5:</b> configuration, CRUD, admin pages, emails, presentational UI, docs.</li>
        <li>A Sonnet task that fails green twice moves to Opus 5.5.</li></ul></div>
    </div>
    <p class="note">Coverage floor: 90% lines for domain and shared code; 100% branches for tokens, HMAC, licence, audit chain and the sanitiser. Phase gates (T034, T057, T067, T078, T100, T106) are adversarial reviews that must close every Severity 1 and 2 finding before the next phase builds on the work.</p>
  </section>
</div>

<div class="drawer-bg" id="drawer-bg" hidden></div>
<aside class="drawer" id="drawer" role="dialog" aria-modal="true" aria-labelledby="d-title" hidden></aside>

<script>
const DATA = ${json};
const byId = Object.fromEntries(DATA.tasks.map(t => [t.id, t]));
const crit = new Set(DATA.criticalPath);
const COLS = [["ready","Ready"],["in-progress","In progress"],["review","Review"],["blocked","Blocked"],["backlog","Backlog"],["done","Done"]];
const modelChip = m => m === "opus-5.5" ? '<span class="chip opus">Opus 5.5</span>' : '<span class="chip sonnet">Sonnet 5.5</span>';
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const state = { phase: "", model: "", edition: "", pkg: "", q: "" };

function stats() {
  const t = DATA.tasks, n = k => t.filter(k).length;
  const items = [
    [t.length, "tasks"], [n(x => x.model === "opus-5.5"), "Opus 5.5"], [n(x => x.model === "sonnet-5.5"), "Sonnet 5.5"],
    [n(x => x.edition === "pro"), "Pro edition"], [DATA.columns.ready.length, "ready now"], [DATA.criticalPath.length, "on the critical path"]];
  document.getElementById("stats").innerHTML = items.map(([v, l]) => '<div class="stat"><b>' + v + '</b><span>' + l + '</span></div>').join("");
}

function phases() {
  const el = document.getElementById("phases"), sel = document.getElementById("f-phase");
  el.innerHTML = DATA.phases.map(p => {
    const ts = DATA.tasks.filter(t => t.phase === p.n), o = ts.filter(t => t.model === "opus-5.5").length;
    const pct = ts.length ? Math.round(o / ts.length * 100) : 0;
    return '<button class="phase" data-phase="' + p.n + '" aria-pressed="false"><span class="num">PHASE ' + p.n + '</span><span class="name">' + esc(p.name) + '</span><span class="exit">' + esc(p.exit) + '</span>' +
      '<span class="bar" aria-hidden="true"><i style="width:' + pct + '%;background:var(--opus)"></i><i style="width:' + (100 - pct) + '%;background:var(--sonnet)"></i></span>' +
      '<span class="meta">' + ts.length + ' tasks · ' + o + ' Opus · ' + (ts.length - o) + ' Sonnet</span></button>';
  }).join("");
  sel.innerHTML += DATA.phases.map(p => '<option value="' + p.n + '">Phase ' + p.n + ': ' + esc(p.name) + '</option>').join("");
  el.addEventListener("click", e => {
    const b = e.target.closest(".phase"); if (!b) return;
    state.phase = state.phase === b.dataset.phase ? "" : b.dataset.phase; sel.value = state.phase; render();
  });
  const pk = document.getElementById("f-pkg");
  [...new Set(DATA.tasks.map(t => t.pkg))].sort().forEach(p => pk.insertAdjacentHTML("beforeend", '<option value="' + p + '">' + p + '</option>'));
}

function critPath() {
  document.getElementById("cp").innerHTML = DATA.criticalPath.map((id, i) =>
    '<li><button data-open="' + id + '" title="' + esc(byId[id].title) + '">' + id + '</button>' + (i < DATA.criticalPath.length - 1 ? '<span class="arrow" aria-hidden="true">→</span>' : '') + '</li>').join("");
}

function matches(t) {
  if (state.phase !== "" && String(t.phase) !== state.phase) return false;
  if (state.model && t.model !== state.model) return false;
  if (state.edition && t.edition !== state.edition) return false;
  if (state.pkg && t.pkg !== state.pkg) return false;
  if (state.q) { const q = state.q.toLowerCase(); if (!(t.id + " " + t.title + " " + t.pkg + " " + t.spec.join(" ")).toLowerCase().includes(q)) return false; }
  return true;
}

function card(t) {
  return '<button class="card" data-open="' + t.id + '"><span class="row"><span class="id">' + t.id + '</span>' + modelChip(t.model) +
    '<span class="chip size">' + t.size + '</span>' + (t.edition === "pro" ? '<span class="chip pro">Pro</span>' : '') + (crit.has(t.id) ? '<span class="chip crit">critical</span>' : '') +
    '</span><span class="t">' + esc(t.title) + '</span><span class="deps">' + (t.deps.length ? 'needs ' + t.deps.join(", ") : 'no dependencies') + (t.unblocks.length ? ' · unblocks ' + t.unblocks.length : '') + '</span></button>';
}

function render() {
  document.querySelectorAll(".phase").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.phase === state.phase)));
  document.getElementById("board").innerHTML = COLS.map(([key, label]) => {
    const ts = DATA.tasks.filter(t => t.column === key && matches(t)).sort((a, b) => a.id.localeCompare(b.id));
    let inner = "";
    if (!ts.length) inner = '<p class="empty">None</p>';
    else if (key === "backlog") {
      const groups = {}; ts.forEach(t => (groups[t.phase] ??= []).push(t));
      inner = Object.keys(groups).sort((a, b) => a - b).map(p => '<div class="group-label">Phase ' + p + '</div>' + groups[p].map(card).join("")).join("");
    } else inner = ts.map(card).join("");
    return '<div class="col" data-col="' + key + '"><h3>' + label + '<span class="count">' + ts.length + '</span></h3>' + inner + '</div>';
  }).join("");
}

function tree(id, dir, depth = 0, seen = new Set()) {
  const t = byId[id], next = dir === "up" ? t.deps : t.unblocks;
  return next.map(n => {
    if (seen.has(n)) return "";
    seen.add(n);
    const c = byId[n];
    return '<li style="padding-left:' + (depth * 14) + 'px"><span aria-hidden="true">' + (depth ? "└" : "•") + '</span><button data-open="' + n + '">' + n + ' ' + esc(c.title) + '</button><span class="st">' + c.column + '</span></li>' + (depth < 2 ? tree(n, dir, depth + 1, seen) : "");
  }).join("");
}

const drawer = document.getElementById("drawer"), bg = document.getElementById("drawer-bg");
let lastFocus = null;
function open(id) {
  const t = byId[id]; if (!t) return;
  lastFocus = lastFocus || document.activeElement;
  drawer.innerHTML = '<div class="head"><button class="close" id="d-close">Close</button><span class="eyebrow">' + t.id + ' · phase ' + t.phase + ' · ' + esc(t.pkg) + ' · ' + t.column + '</span>' +
    '<h2 id="d-title">' + esc(t.title) + '</h2><div class="row" style="display:flex;gap:6px;flex-wrap:wrap">' + modelChip(t.model) + '<span class="chip size">size ' + t.size + '</span>' +
    (t.edition === "pro" ? '<span class="chip pro">Pro</span>' : '<span class="chip size">Free</span>') + (crit.has(t.id) ? '<span class="chip crit">critical path</span>' : '') + '</div>' +
    (t.spec.length ? '<div class="deps" style="font:.75rem var(--f-mono);color:var(--muted)">spec: ' + esc(t.spec.join(" · ")) + '</div>' : '') + '</div>' +
    '<div class="links"><div><h3>Depends on</h3><ul class="tree">' + (tree(id, "up") || '<li class="st">Nothing</li>') + '</ul></div>' +
    '<div><h3>Unblocks</h3><ul class="tree">' + (tree(id, "down") || '<li class="st">Nothing</li>') + '</ul></div></div>' +
    '<div class="body">' + t.html + '</div><p class="deps" style="font:.75rem var(--f-mono);color:var(--muted)">tasks/' + esc(t.file) + '</p>';
  drawer.hidden = false; bg.hidden = false; drawer.scrollTop = 0;
  document.getElementById("d-close").focus();
}
function close() { drawer.hidden = true; bg.hidden = true; if (lastFocus) lastFocus.focus(); lastFocus = null; }
document.addEventListener("click", e => {
  const o = e.target.closest("[data-open]"); if (o) { open(o.dataset.open); return; }
  if (e.target.id === "d-close" || e.target === bg) close();
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && !drawer.hidden) close(); });

["f-phase","f-model","f-edition","f-pkg"].forEach(id => document.getElementById(id).addEventListener("change", e => {
  state[{ "f-phase": "phase", "f-model": "model", "f-edition": "edition", "f-pkg": "pkg" }[id]] = e.target.value; render(); }));
document.getElementById("q").addEventListener("input", e => { state.q = e.target.value.trim(); render(); });

stats(); phases(); critPath(); render();
const h = location.hash.slice(1); if (/^T\\d{3}$/.test(h)) open(h);
</script>
`;
writeFileSync(out, html);
console.log("wrote", out, html.length);
