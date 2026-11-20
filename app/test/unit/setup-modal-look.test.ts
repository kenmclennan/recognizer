import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { describe, expect, it } from "vitest";
import { HIDE_SCROLLBARS, lookBrowserArgs, webkit } from "../../src/look-page";

const srcUrl = new URL("../../src/index.ts", import.meta.url).href;

const here = (name: string) => fileURLToPath(new URL(name, srcUrl));

const HARNESS = `
import { openSetupModal } from ${JSON.stringify(here("setup-modal-view.ts"))};
import { CLEAN_DOCTOR, fakeSetup } from ${JSON.stringify(here("setup-fake.ts"))};

const settle = () => new Promise((resolve) => setTimeout(resolve, 40));
const LOG_SENTENCE = "A log of this run";
const box = (node) => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
const facts = { screens: {}, lifecycle: {}, rowClicks: {} };

function prose(root) {
  const copy = root.cloneNode(true);
  for (const node of copy.querySelectorAll(".sw-mono, .sw-code, pre, code, textarea, input")) node.remove();
  return copy.textContent;
}

function snap(modal, name) {
  const q = (s) => modal.element.querySelector(s);
  const body = q(".sw-body");
  const dialog = q(".settings-modal");
  facts.screens[name] = {
    text: prose(body),
    heading: (q(".sw-body h2") || { textContent: "" }).textContent,
    steps: [...modal.element.querySelectorAll(".sw-step")].map((n) => n.dataset.step + (n.classList.contains("skip") ? ":skip" : n.classList.contains("now") ? ":now" : n.classList.contains("done") ? ":done" : "")),
    foot: [...modal.element.querySelectorAll(".sw-foot button")].filter((b) => !b.hidden).map((b) => b.textContent + (b.disabled ? " (disabled)" : "")),
    insideScrim: box(dialog).left >= box(modal.element).left && box(dialog).right <= box(modal.element).right && box(dialog).top >= box(modal.element).top && box(dialog).bottom <= box(modal.element).bottom,
    paneFitsModal: box(body).right <= box(dialog).right && box(body).bottom <= box(dialog).bottom,
    noHorizontalOverflow: body.scrollWidth <= body.clientWidth,
    rows: [...modal.element.querySelectorAll(".sw-row .sw-what")].map((n) => n.textContent),
    details: [...modal.element.querySelectorAll(".sw-row")].map((r) => { const panel = r.querySelector(".sw-panel"); if (!panel) return null; const pre = panel.querySelector("pre"); const toggle = panel.querySelector(".sw-toggle"); return { label: toggle.textContent, text: pre.textContent, hidden: pre.hidden, state: panel.dataset.open, chevron: toggle.querySelector("svg") !== null }; }),
    cards: [...modal.element.querySelectorAll(".sw-rec .sw-what")].map((n) => n.textContent),
    groups: [...modal.element.querySelectorAll(".sw-group")].map((n) => n.textContent),
    marks: [...modal.element.querySelectorAll(".sw-mark")].map((n) => n.textContent),
    rowBoxes: [...modal.element.querySelectorAll(".sw-row")].map((r) => r.querySelector("input") !== null),
    env: [...modal.element.querySelectorAll(".sw-envrow code")].map((n) => n.textContent),
    runners: [...modal.element.querySelectorAll(".sw-runner")].map((n) => n.textContent),
    notes: [...modal.element.querySelectorAll(".sw-body .sw-note")].map((n) => n.textContent),
    runnerOutputs: [...modal.element.querySelectorAll(".sw-runner")].map((n) => {
      const panel = n.nextElementSibling;
      const box = panel && panel.querySelector("pre");
      const toggle = panel && panel.querySelector(".sw-toggle");
      return panel && panel.classList.contains("sw-panel") && box ? { hidden: box.hidden, text: box.textContent, label: toggle.textContent } : null;
    }),
  };
}

(async () => {
  let release = () => {};
  const fake = fakeSetup({ progress: ["Read 65 files and 212 imports"] });
  let closedCalls = 0;
  const modal = openSetupModal({ port: fake, onClose: () => { closedCalls += 1; } });
  facts.lifecycle.attachedOnOpen = document.body.contains(modal.element) && document.body.querySelectorAll(".setup-modal").length === 1;
  await modal.ready;
  await settle();
  const q = (s) => modal.element.querySelector(s);
  const qa = (s) => [...modal.element.querySelectorAll(s)];
  const next = () => { modal.controller.next(); return settle(); };

  snap(modal, "files");
  facts.openCalls = fake.calls.slice();
  await next();
  snap(modal, "checks");
  const plugin = q('[data-control^="plugin-"]');
  const pluginBefore = plugin.checked;
  plugin.closest(".sw-row").querySelector(".sw-why").click();
  await settle();
  facts.rowClicks.checkToggled = plugin.checked !== pluginBefore;
  facts.rowClicks.pointer = getComputedStyle(q('[data-control^="plugin-"]').closest(".sw-row")).cursor;
  plugin.closest(".sw-row").querySelector(".sw-why").click();
  await settle();
  facts.rowClicks.checkToggledBack = plugin.checked === pluginBefore;
  const analysis = q('[data-control="analysis"]');
  const limit = analysis.closest(".sw-row").querySelector(".sw-num");
  const analysisBefore = analysis.checked;
  limit.click();
  await settle();
  facts.rowClicks.limitKeptRow = analysis.checked === analysisBefore;
  await next();

  qa("button").find((b) => b.textContent === "Add a variable").click();
  await settle();
  q('[data-control="env-name"]').value = "RUST_LOG";
  q('[data-control="env-value"]').value = "debug";
  qa("button").find((b) => b.textContent === "Add").click();
  await settle();
  snap(modal, "tests");

  qa("button").find((b) => b.textContent === "Run once").click();
  await settle();
  await settle();
  snap(modal, "tests-tried");
  await next();

  q('[data-control="policy-ask"]').closest(".sw-row").querySelector(".sw-what").click();
  await settle();
  facts.rowClicks.policyAskByText = q('[data-control="policy-ask"]').checked && !q('[data-control="policy-skip"]').checked;
  q('[data-control="policy-skip"]').closest(".sw-row").querySelector(".sw-why").click();
  await settle();
  facts.rowClicks.policySkipByText = q('[data-control="policy-skip"]').checked && !q('[data-control="policy-ask"]').checked;
  q('[data-control="policy-ask"]').closest(".sw-row").querySelector(".sw-what").click();
  await settle();
  snap(modal, "policy-choice");
  fake.gate = new Promise((resolve) => { release = resolve; });
  qa("button").find((b) => b.textContent === "Ask Claude").click();
  await settle();
  snap(modal, "policy-running");
  facts.rowClicks.askButtonKeptRow = modal.controller.state().policyMode === "ask";
  release();
  fake.gate = null;
  await settle();
  await settle();
  snap(modal, "policy-cards");
  qa('[data-decide="0:accept"]')[0].click();
  await settle();
  await next();
  snap(modal, "review");

  fake.gate = new Promise((resolve) => { release = resolve; });
  qa("button").find((b) => b.textContent.startsWith("Apply")).click();
  await settle();
  snap(modal, "apply-running");
  release();
  fake.gate = null;
  await settle();
  await settle();
  snap(modal, "apply-done");
  modal.close();
  facts.lifecycle.goneAfterClose = document.querySelector(".setup-modal") === null;
  facts.lifecycle.closedCalls = closedCalls;

  const outputting = fakeSetup({ notReady: { tauri: "no report" }, notReadyOutput: { tauri: "engine not built" } });
  const third = openSetupModal({ port: outputting });
  await third.ready;
  for (let i = 0; i < 2; i++) { third.controller.next(); await settle(); }
  [...third.element.querySelectorAll("button")].find((b) => b.textContent === "Run once").click();
  await settle();
  await settle();
  snap(third, "tried-output");
  [...third.element.querySelectorAll(".sw-runner + .sw-panel .sw-toggle")][0].click();
  snap(third, "tried-output-open");
  third.close();

  const failing = fakeSetup({ failAt: 1 });
  const second = openSetupModal({ port: failing });
  await second.ready;
  for (let i = 0; i < 4; i++) second.controller.next();
  await settle();
  await second.controller.apply();
  await settle();
  snap(second, "apply-failed");
  second.close();

  let escCalls = 0;
  const esc = openSetupModal({ port: fakeSetup({}), onClose: () => { escCalls += 1; } });
  await esc.ready;
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  facts.lifecycle.escapeClosed = document.querySelector(".setup-modal") === null && escCalls === 1;

  let scrimCalls = 0;
  const sc = openSetupModal({ port: fakeSetup({}), onClose: () => { scrimCalls += 1; } });
  await sc.ready;
  sc.element.querySelector(".settings-modal").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  facts.lifecycle.insideClickKept = document.querySelector(".setup-modal") !== null && scrimCalls === 0;
  sc.element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  facts.lifecycle.scrimClosed = document.querySelector(".setup-modal") === null && scrimCalls === 1;

  const live = fakeSetup({});
  const during = openSetupModal({ port: live });
  await during.ready;
  for (let i = 0; i < 4; i++) during.controller.next();
  await settle();
  live.gate = new Promise(() => {});
  const applying = during.controller.apply();
  await settle();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  await settle();
  facts.lifecycle.stopCalls = live.calls.filter((c) => c === "stop_setup").length;
  facts.lifecycle.closedDuringApply = document.querySelector(".setup-modal") === null;

  facts.cancel = {};
  const cancelAt = async (name, steps, loading) => {
    const calls = [];
    let closes = 0;
    const port = loading ? fakeSetup({ surveyLines: [new Promise(() => {})] }) : fakeSetup({});
    const m = openSetupModal({ port, onClose: () => { closes += 1; } });
    if (!loading) await m.ready;
    await settle();
    for (let i = 0; i < steps; i++) { m.controller.next(); await settle(); }
    const foot = [...m.element.querySelectorAll(".sw-foot button")].filter((b) => !b.hidden).map((b) => b.textContent);
    const button = [...m.element.querySelectorAll(".sw-foot button")].find((b) => b.textContent === "Cancel" && !b.hidden);
    if (button) button.click();
    await settle();
    facts.cancel[name] = { foot, closed: document.querySelector(".setup-modal") === null, closeCalls: closes, applied: port.calls.includes("apply") };
    if (document.querySelector(".setup-modal") !== null) m.close();
  };
  await cancelAt("loading", 0, true);
  await cancelAt("files", 0, false);
  await cancelAt("checks", 1, false);
  await cancelAt("tests", 2, false);
  await cancelAt("policy", 3, false);
  await cancelAt("review", 4, false);

  const problemOf = (n) => ({ code: "config-retired", subject: "k" + n, title: "Settings moved to new places " + n, line: "config/sensors/thresholds was retired " + n, fix: { text: "Run the move " + n, command: "recognizer config --unset k" + n }, severity: "problem" });
  const reportOf = (count) => ({ repository: "/repo", ok: count === 0, problems: count, warnings: 0, areas: count === 0 ? [] : [{ name: "config", skipped: null, problems: Array.from({ length: count }, (_, i) => problemOf(i + 1)) }] });
  const base = fakeSetup({}).surveyRead.survey;
  const fixOf = (n) => ({ code: "config-retired", subject: "k" + n, title: "Settings moved to new places " + n, line: "config/sensors/thresholds was retired " + n, fix_text: "Run the move " + n, command: "recognizer config --unset k" + n });
  const handFix = { code: "config-duplicate-suite", subject: "unit", title: "Two test suites share a name", line: "tests: unit appears twice", fix_text: "Rename one of the suites in .recognizer/config.yaml", command: null };
  const suiteOf = (name, mark) => ({ name, language: "typescript", directory: name, command: "npx vitest run", mark });
  const rerunSurvey = {
    ...base,
    configured: true,
    files: [...base.files.map((l) => ({ ...l, mark: "set-up" })), { language: "python", files: 0, folders: [], mark: "gone" }],
    checks: base.checks.map((c) => { const enabled = c.id === "crap" ? true : c.enabled; return { ...c, enabled, mark: enabled ? "set-up" : "new" }; }),
    suites: [suiteOf("legacy", "gone"), suiteOf("server", "set-up")],
    fixes: [fixOf(1), fixOf(2), handFix],
    policy: { present: true, uncovered: ["web", "tools"] },
  };
  const calmSurvey = {
    ...rerunSurvey,
    runners: [],
    tools: [],
    suites: [suiteOf("server", "set-up")],
    files: base.files.map((l) => ({ ...l, mark: "set-up" })),
    fixes: [],
    policy: { present: true, uncovered: [] },
  };
  const rerunPort = (extra = {}) => fakeSetup({ surveyRead: { status: "ok", survey: rerunSurvey, doctor: { status: "ok", report: reportOf(3) } }, ...extra });

  const noteText = 'no JaCoCo: add id("jacoco") to the plugins { } block of build.gradle.kts; Recognizer does not edit build files';
  const noted = openSetupModal({ port: fakeSetup({ surveyRead: { status: "ok", survey: { ...base, runners: [], tools: [], notes: [{ language: "kotlin", directory: ".", text: noteText }] }, doctor: { status: "ok", report: reportOf(0) } } }) });
  await noted.ready;
  await settle();
  noted.controller.next();
  await settle();
  noted.controller.next();
  await settle();
  snap(noted, "tests-note");

  const rerun = openSetupModal({ port: rerunPort() });
  await rerun.ready;
  await settle();
  snap(rerun, "rerun-files");
  rerun.controller.next();
  await settle();
  snap(rerun, "rerun-checks");
  rerun.controller.next();
  await settle();
  snap(rerun, "rerun-tests");
  rerun.controller.next();
  await settle();
  snap(rerun, "rerun-policy");
  rerun.controller.setPolicyMode("ask");
  await rerun.controller.askClaude();
  await settle();
  rerun.controller.acceptRemaining();
  rerun.controller.setLimit("long_function", 31);
  rerun.controller.next();
  await settle();
  snap(rerun, "rerun-review");
  const openRow = rerun.element.querySelector(".sw-row .sw-toggle").closest(".sw-row");
  const titleBefore = openRow.querySelector(".sw-what").getBoundingClientRect().width;
  openRow.querySelector(".sw-toggle").click();
  const titleBox = openRow.querySelector(".sw-what").getBoundingClientRect();
  const toggleBox = openRow.querySelector(".sw-toggle").getBoundingClientRect();
  const detailBox = openRow.querySelector("pre").getBoundingClientRect();
  const rowBox = openRow.getBoundingClientRect();
  facts.disclosure = {
    titleWidthKept: Math.abs(titleBox.width - titleBefore) < 1,
    toggleClear: toggleBox.right <= titleBox.left || toggleBox.left >= titleBox.right || toggleBox.bottom <= titleBox.top || toggleBox.top >= titleBox.bottom,
    detailBelowTitle: detailBox.top >= titleBox.bottom,
    detailWiderThanTitle: detailBox.width > titleBox.width,
    detailSpansRow: detailBox.right <= rowBox.right && detailBox.width > rowBox.width * 0.8,
  };
  snap(rerun, "rerun-review-open");
  rerun.controller.setFix(0, false);
  await settle();
  snap(rerun, "rerun-review-unticked");
  rerun.close();

  const calm = openSetupModal({ port: fakeSetup({ surveyRead: { status: "ok", survey: calmSurvey, doctor: CLEAN_DOCTOR } }) });
  await calm.ready;
  await settle();
  snap(calm, "calm-files");
  for (let i = 0; i < 3; i++) calm.controller.next();
  await settle();
  snap(calm, "calm-policy");
  calm.controller.next();
  await settle();
  snap(calm, "calm-review");
  calm.close();

  const gapOf = (title, subject, fix) => ({ code: "sensor-gap", subject, title, line: subject + " has a gap", fix: { text: fix, command: null }, severity: "problem" });
  const named = { ok: false, repository: "/repo", problems: 2, warnings: 0, areas: [{ name: "sensors", skipped: null, problems: [gapOf("C.R.A.P. cannot run as set up", "crap", "Run the crap help"), gapOf("Mutation cannot run as set up", "mutation", "Run the mutation help")] }] };
  const finals = { one: reportOf(1), two: reportOf(2), clean: reportOf(0), unavailable: null, named };
  for (const [name, doctor] of Object.entries(finals)) {
    const up = openSetupModal({ port: rerunPort({ applyDoctor: doctor }) });
    await up.ready;
    await settle();
    for (let i = 0; i < 4; i++) up.controller.next();
    await settle();
    await up.controller.apply();
    await settle();
    snap(up, "final-" + name);
    if (name === "named") {
      facts.namedPairs = [...up.element.querySelectorAll(".sw-what")].filter((n) => n.nextElementSibling && n.nextElementSibling.classList.contains("sw-why")).map((n) => [n.textContent, n.nextElementSibling.textContent]);
    }
    up.close();
  }

  facts.progress = {};
  const shot = (name, m) => {
    const q = (sel) => m.element.querySelector(sel);
    const qa = (sel) => [...m.element.querySelectorAll(sel)];
    const fill = q(".sw-fill");
    const bar = q(".sw-bar");
    const icon = q(".sw-row svg");
    facts.progress[name] = {
      heading: (q(".sw-body h2") || { textContent: "" }).textContent,
      foot: qa(".sw-foot button").filter((b) => !b.hidden).map((b) => b.textContent),
      text: q(".sw-body").textContent,
      titles: qa(".sw-row .sw-what").map((n) => n.textContent),
      spinners: qa(".sw-row svg.sw-icon-spinner").length,
      ticks: qa(".sw-row svg.sw-icon-tick").length,
      circles: qa(".sw-row svg.sw-icon-circle").length,
      glyphLeads: qa(".sw-row .sw-lead").filter((n) => n.querySelector("svg") === null && n.textContent.trim() !== "").length,
      times: qa(".sw-row .sw-time").length,
      elapsed: (q(".sw-elapsed") || { textContent: "" }).textContent,
      fillRatio: fill && bar ? fill.getBoundingClientRect().width / bar.getBoundingClientRect().width : -1,
      iconSquare: icon ? icon.getBoundingClientRect().width === icon.getBoundingClientRect().height : false,
      runningLines: qa(".sw-row.state-running .sw-why").map((n) => n.textContent),
    };
  };
  const feed = (o) => JSON.stringify(o);
  let freeMid = () => {};
  let freeEnd = () => {};
  const holdMid = new Promise((resolve) => { freeMid = resolve; });
  const holdEnd = new Promise((resolve) => { freeEnd = resolve; });
  const unscanned = openSetupModal({ port: fakeSetup({ surveyLines: [
    feed({ event: "step", step: "survey", state: "run" }),
    feed({ event: "step", step: "survey", state: "done" }),
    feed({ event: "step", step: "scan", state: "run" }),
    feed({ event: "phase", phase: "extract", state: "run", commit: null, languages: ["typescript"] }),
    feed({ event: "plugin", phase: "extract", name: "typescript", data: { event: "start", total: 125, unit: "files" } }),
    holdMid,
    feed({ event: "plugin", phase: "extract", name: "typescript", data: { event: "progress", done: 125, total: 125, unit: "files" } }),
    feed({ event: "entry", phase: "extract", name: "typescript", outcome: "ok", modules: 3, edges: 2 }),
    feed({ event: "structure", state: "run" }),
    feed({ event: "structure", state: "done", files: 125 }),
    feed({ event: "step", step: "scan", state: "done" }),
    feed({ event: "step", step: "reading", state: "run" }),
    holdEnd,
  ] }) });
  await settle();
  shot("scan-mid", unscanned);
  freeMid();
  await settle();
  shot("scan-end", unscanned);
  freeEnd();
  await unscanned.ready;
  unscanned.close();

  let freeScanned = () => {};
  const holdScanned = new Promise((resolve) => { freeScanned = resolve; });
  const scanned = openSetupModal({ port: fakeSetup({ surveyLines: [
    feed({ event: "step", step: "survey", state: "run" }),
    feed({ event: "step", step: "survey", state: "done" }),
    feed({ event: "step", step: "reading", state: "run" }),
    holdScanned,
  ] }) });
  await settle();
  shot("scanned", scanned);
  freeScanned();
  await scanned.ready;
  scanned.close();

  let freeCommand = () => {};
  let freeDoctor = () => {};
  let freeReload = () => {};
  const holdCommand = new Promise((resolve) => { freeCommand = resolve; });
  const holdDoctor = new Promise((resolve) => { freeDoctor = resolve; });
  const holdReload = new Promise((resolve) => { freeReload = resolve; });
  const stepping = openSetupModal({ port: fakeSetup({ holdAfterCommand: holdCommand, holdDoctor }), reloadSensors: () => holdReload });
  await stepping.ready;
  for (let i = 0; i < 4; i++) stepping.controller.next();
  await settle();
  const applied = stepping.controller.apply();
  await settle();
  shot("apply-command", stepping);
  freeCommand();
  await settle();
  shot("apply-doctor", stepping);
  freeDoctor();
  await settle();
  shot("apply-reload", stepping);
  freeReload();
  await applied;
  await settle();
  shot("apply-finished", stepping);
  stepping.close();


  facts.done = {};
  const handProblem = { code: "config-duplicate-suite", subject: "unit", title: "Two test suites share a name", line: "tests: unit appears twice", fix: { text: "Rename one of the suites", command: null }, severity: "problem" };
  const pluginProblem = { code: "unregistered-plugin", subject: "claude", title: "Claude is not registered", line: "claude is installed but not registered", fix: { text: "Register the plugin", command: "recognizer plugin add claude" }, severity: "problem" };
  const reportWith = (list) => ({ repository: "/repo", ok: list.length === 0, problems: list.length, warnings: 0, areas: list.length === 0 ? [] : [{ name: "config", skipped: null, problems: list }] });
  const claudeCheck = { id: "claude", display: "Claude", description: "describes", always_on: false, enabled: false, runs_tests: false, limits: [], mark: null };
  const doneSurvey = { ...base, fixes: [fixOf(1), fixOf(2)], checks: [...base.checks, claudeCheck] };
  const finishWith = async (applyDoctor, extra = {}) => {
    const port = fakeSetup({ surveyRead: { status: "ok", survey: doneSurvey, doctor: { status: "ok", report: reportOf(2) } }, applyDoctor, ...extra });
    const m = openSetupModal({ port });
    await m.ready;
    await settle();
    for (let i = 0; i < 4; i++) m.controller.next();
    await settle();
    await m.controller.apply();
    await settle();
    return { port, m };
  };
  const doneOf = (m) => {
    const callout = m.element.querySelector(".sw-body .sw-callout");
    const rows = [...m.element.querySelectorAll(".sw-body > .sw-row")].map((r) => r.getBoundingClientRect());
    const calloutBox = callout.getBoundingClientRect();
    const buttons = [...callout.querySelectorAll("button")];
    return {
      heading: m.element.querySelector(".sw-body h2").textContent,
      calloutClass: callout.className,
      lead: callout.querySelector(".sw-what").textContent,
      lastLine: callout.lastElementChild.textContent,
      calloutAboveRows: rows.length >= 2 && calloutBox.bottom <= rows[0].top,
      gapBelowCallout: rows.length >= 2 ? rows[0].top - calloutBox.bottom : -1,
      gapBetweenRows: rows.length >= 2 ? rows[1].top - rows[0].bottom : -2,
      rowCount: rows.length,
      blocks: [...callout.querySelectorAll(".sw-problem")].map((b) => { const act = b.querySelector("button"); return { text: b.textContent, button: act ? act.textContent : null, disabled: act ? act.disabled : null, orRun: b.textContent.includes("Or run"), bold: b.querySelector(".sw-what").textContent }; }),
      buttonsDisabled: buttons.map((b) => b.disabled),
      logSentence: {
        inFooter: m.element.querySelector(".sw-foot").textContent.split(LOG_SENTENCE).length - 1,
        inBody: m.element.querySelector(".sw-body").textContent.split(LOG_SENTENCE).length - 1,
        inCards: [...m.element.querySelectorAll(".sw-body .sw-row, .sw-body .sw-callout")].filter((c) => c.textContent.includes(LOG_SENTENCE)).length,
        inModal: m.element.textContent.split(LOG_SENTENCE).length - 1,
      },
    };
  };
  const pressFix = async (m, at) => { [...m.element.querySelectorAll(".sw-problem button")][at].click(); await settle(); };

  const first = await finishWith(reportWith([problemOf(1), handProblem]));
  facts.done.two = doneOf(first.m);
  first.m.close();

  let freeFix = () => {};
  const held = await finishWith(reportWith([problemOf(1), problemOf(2)]));
  held.port.gate = new Promise((resolve) => { freeFix = resolve; });
  const before = held.port.applied.length;
  await pressFix(held.m, 0);
  facts.done.running = doneOf(held.m);
  held.port.applyDoctor = reportWith([problemOf(2)]);
  freeFix();
  held.port.gate = null;
  await settle();
  await settle();
  facts.done.fixed = doneOf(held.m);
  facts.done.appliedByFix = held.port.applied.slice(before);
  facts.done.fixedCalls = held.port.calls.filter((c) => c === "apply").length;
  held.port.applyDoctor = reportWith([]);
  await pressFix(held.m, 0);
  facts.done.green = doneOf(held.m);
  held.m.close();

  const stuck = await finishWith(reportWith([problemOf(1)]));
  await pressFix(stuck.m, 0);
  facts.done.stuck = doneOf(stuck.m);
  stuck.m.close();

  const registered = await finishWith(reportWith([pluginProblem]));
  await pressFix(registered.m, 0);
  facts.done.pluginApplied = registered.port.applied[registered.port.applied.length - 1];
  facts.done.pluginButton = null;
  registered.m.close();
  const pluginAgain = await finishWith(reportWith([pluginProblem]));
  facts.done.pluginButton = doneOf(pluginAgain.m).blocks[0].button;
  pluginAgain.m.close();

  const sameText = await finishWith(reportWith([{ ...problemOf(1), fix: { text: "recognizer config --unset k1", command: "recognizer config --unset k1" } }]));
  facts.done.sameText = { ...doneOf(sameText.m), mentions: sameText.m.element.querySelector(".sw-problem").textContent.split("recognizer config --unset k1").length - 1 };
  sameText.m.close();

  const clean = await finishWith(reportWith([]));
  facts.done.clean = doneOf(clean.m);
  clean.m.close();

  const panelsOf = (m) => [...m.element.querySelectorAll(".sw-body > .sw-row")].map((r) => {
    const panel = r.querySelector(".sw-panel");
    const base = { cls: r.className, border: getComputedStyle(r).borderTopColor, text: r.querySelector(".sw-main").textContent };
    if (!panel) return { ...base, panel: null };
    const toggle = panel.querySelector(".sw-toggle");
    const pre = panel.querySelector("pre");
    const svg = toggle.querySelector("svg");
    return { ...base, panel: {
      label: toggle.textContent,
      state: panel.dataset.open,
      hidden: pre.hidden,
      text: pre.textContent,
      chevron: svg !== null,
      chevronSize: svg ? svg.getBoundingClientRect().width : 0,
      turned: svg ? getComputedStyle(svg).transform !== "none" : false,
      belowMain: panel.getBoundingClientRect().top >= r.querySelector(".sw-main").getBoundingClientRect().bottom,
      spansCard: panel.getBoundingClientRect().width >= r.getBoundingClientRect().width - 26,
      ruled: getComputedStyle(panel).borderTopWidth !== "0px",
      maxHeight: getComputedStyle(pre).maxHeight,
    } };
  });
  const printed = await finishWith(reportWith([]), { doneOutput: "one\\ntwo\\nthree\\n" });
  facts.done.panels = panelsOf(printed.m);
  const toggleAt = printed.m.element.querySelector(".sw-body > .sw-row .sw-toggle");
  toggleAt.click();
  facts.done.opened = panelsOf(printed.m)[0].panel.state;
  printed.m.close();

  const broken = fakeSetup({ failAt: 1, doneOutput: "one\\ntwo\\nthree\\n" });
  const brokenModal = openSetupModal({ port: broken });
  await brokenModal.ready;
  for (let i = 0; i < 4; i++) brokenModal.controller.next();
  await settle();
  await brokenModal.controller.apply();
  await settle();
  facts.done.failed = { heading: brokenModal.element.querySelector(".sw-body h2").textContent, bar: brokenModal.element.querySelector(".sw-fill").className, callout: brokenModal.element.querySelector(".sw-callout").textContent, calloutClass: brokenModal.element.querySelector(".sw-callout").className, rows: panelsOf(brokenModal) };
  brokenModal.close();

  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Screen = {
  text: string;
  heading: string;
  steps: string[];
  foot: string[];
  insideScrim: boolean;
  paneFitsModal: boolean;
  noHorizontalOverflow: boolean;
  rows: string[];
  details: ({
    label: string;
    text: string;
    hidden: boolean;
    state: string;
    chevron: boolean;
  } | null)[];
  cards: string[];
  groups: string[];
  marks: string[];
  rowBoxes: boolean[];
  env: string[];
  runners: string[];
  notes: string[];
  runnerOutputs: ({ hidden: boolean; text: string; label: string } | null)[];
};

type Shot = {
  heading: string;
  foot: string[];
  text: string;
  titles: string[];
  spinners: number;
  ticks: number;
  circles: number;
  glyphLeads: number;
  times: number;
  elapsed: string;
  fillRatio: number;
  iconSquare: boolean;
  runningLines: string[];
};

type PanelFact = {
  label: string;
  state: string;
  hidden: boolean;
  text: string;
  chevron: boolean;
  chevronSize: number;
  turned: boolean;
  belowMain: boolean;
  spansCard: boolean;
  ruled: boolean;
  maxHeight: string;
};
type CardFact = {
  cls: string;
  border: string;
  text: string;
  panel: PanelFact | null;
};
type DoneFact = {
  heading: string;
  calloutClass: string;
  lead: string;
  lastLine: string;
  calloutAboveRows: boolean;
  gapBelowCallout: number;
  gapBetweenRows: number;
  rowCount: number;
  blocks: {
    text: string;
    button: string | null;
    disabled: boolean | null;
    orRun: boolean;
    bold: string;
  }[];
  buttonsDisabled: boolean[];
  logSentence: {
    inFooter: number;
    inBody: number;
    inCards: number;
    inModal: number;
  };
};
type Facts = {
  done: Record<string, DoneFact> & {
    sameText: DoneFact & { mentions: number };
    appliedByFix: unknown[];
    fixedCalls: number;
    pluginApplied: unknown;
    pluginButton: string | null;
    panels: CardFact[];
    opened: string;
    failed: {
      heading: string;
      bar: string;
      callout: string;
      calloutClass: string;
      rows: CardFact[];
    };
  };
  disclosure: Record<string, boolean>;
  namedPairs: string[][];
  progress: Record<string, Shot>;
  rowClicks: {
    checkToggled: boolean;
    checkToggledBack: boolean;
    pointer: string;
    limitKeptRow: boolean;
    policyAskByText: boolean;
    policySkipByText: boolean;
    askButtonKeptRow: boolean;
  };
  screens: Record<string, Screen>;
  openCalls: string[];
  lifecycle: {
    attachedOnOpen: boolean;
    goneAfterClose: boolean;
    closedCalls: number;
    escapeClosed: boolean;
    insideClickKept: boolean;
    scrimClosed: boolean;
    stopCalls: number;
    closedDuringApply: boolean;
  };
  cancel: Record<
    string,
    { foot: string[]; closed: boolean; closeCalls: number; applied: boolean }
  >;
};

function collect(): Facts {
  const dir = mkdtempSync(join(tmpdir(), "setup-modal-look-"));

  try {
    const bundle = buildSync({
      stdin: { contents: HARNESS, resolveDir: here("."), loader: "ts" },
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
    }).outputFiles[0].text;
    const css = readFileSync(here("style.css"), "utf8");
    const page = join(dir, "page.html");

    writeFileSync(
      page,
      `<!doctype html><html><head><style>${css}${HIDE_SCROLLBARS}</style></head><body><div id="out"></div><script>${bundle.replaceAll("</script", "<\\/script")}</script></body></html>`,
    );

    const run = spawnSync(
      process.execPath,
      lookBrowserArgs(page, { size: "1200x800" }),
      { encoding: "utf8", timeout: 60000, maxBuffer: 16 * 1024 * 1024 },
    );
    const match = /<div id="out">([^<]*)<\/div>/.exec(run.stdout);

    if (match === null || !/^[A-Za-z0-9+/=]+$/.test(match[1])) {
      throw new Error(
        `no harness output: ${run.stderr.slice(0, 500)} ${run.error}`,
      );
    }

    const text = Buffer.from(match[1], "base64").toString("utf8");

    if (text.startsWith("ERR ")) {
      throw new Error(text);
    }

    return JSON.parse(text) as Facts;
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
}

describe.skipIf(webkit === undefined)(
  "the setup wizard in a real browser",
  () => {
    const f = (webkit === undefined ? null : collect()) as Facts;
    const names = [
      "files",
      "checks",
      "tests",
      "tests-tried",
      "policy-choice",
      "policy-running",
      "policy-cards",
      "review",
      "apply-running",
      "apply-done",
      "apply-failed",
    ];

    describe("progress while reading and applying", () => {
      const shot = (name: string) => f.progress[name] as Shot;

      it("opening Setup on an unscanned folder shows the three rows, the lead line and a per-language line before Files", () => {
        const mid = shot("scan-mid");

        expect(mid).toBeDefined();
        expect(mid.heading).toBe("Reading the repository");
        expect(mid.titles).toEqual([
          "Finding languages and test setups",
          "Scanning the files",
          "Reading what the scan found",
        ]);
        expect(mid.text).toContain(
          "This happens once, the first time Setup opens on a folder that has never been scanned.",
        );
        expect(mid.text).toContain("TypeScript: reading...");
        expect(mid.spinners).toBe(1);
        expect(mid.ticks).toBe(1);
        expect(mid.circles).toBe(1);
        expect(mid.glyphLeads).toBe(0);
        expect(mid.iconSquare).toBe(true);
        expect(mid.fillRatio).toBeGreaterThan(0);
        expect(mid.fillRatio).toBeLessThan(1);
        expect(mid.elapsed).toMatch(/^\d+\.\ds$/);
      });

      it("finished scan lines show the file count and the duplication count, and finished rows their time", () => {
        const end = shot("scan-end");

        expect(end.text).toContain("TypeScript: 125 files");
        expect(end.text).toContain("Duplication: 125 files compared");
        expect(end.ticks).toBe(2);
        expect(end.times).toBe(2);
        expect(end.fillRatio).toBeGreaterThan(shot("scan-mid").fillRatio);
      });

      it("a folder already scanned shows only the rows that run and no lead line", () => {
        const read = shot("scanned");

        expect(read.titles).toEqual([
          "Finding languages and test setups",
          "Reading what the scan found",
        ]);
        expect(read.text).not.toContain("This happens once");
        expect(read.spinners).toBe(1);
      });

      it("Apply shows a spinning first row with its step and command, and a bar above zero after the first command", () => {
        const hold = shot("apply-command");

        expect(hold.spinners).toBe(1);
        expect(hold.runningLines[0]).toMatch(/^Step 1 of \d+$/);
        expect(hold.runningLines.length).toBeGreaterThanOrEqual(2);
        expect(hold.fillRatio).toBeGreaterThan(0);
        expect(hold.titles.slice(-2)).toEqual([
          "Checking the setup",
          "Loading the checks",
        ]);
        expect(hold.glyphLeads).toBe(0);
      });

      it("the two finishing rows spin in turn and then show their time", () => {
        expect(shot("apply-doctor").runningLines).toEqual([]);
        expect(shot("apply-doctor").spinners).toBeGreaterThanOrEqual(1);
        expect(shot("apply-reload").spinners).toBe(1);
        expect(shot("apply-reload").times).toBeGreaterThan(
          shot("apply-doctor").times,
        );

        const done = shot("apply-finished");

        expect(done.spinners).toBe(0);
        expect(done.times).toBe(done.titles.length);
        expect(done.titles.slice(-2)).toEqual([
          "Checking the setup",
          "Loading the checks",
        ]);
        expect(done.elapsed).toMatch(/^\d+\.\ds$/);
      });
    });

    it("fits the modal within the window and the pane within the modal", () => {
      for (const name of names) {
        const screen = f.screens[name] as Screen;

        expect(screen.insideScrim, name).toBe(true);
        expect(screen.paneFitsModal, name).toBe(true);
        expect(screen.noHorizontalOverflow, name).toBe(true);
      }
    });

    it("attaches itself to the page on open and leaves it on close, as main.ts uses it", () => {
      expect(f.lifecycle.attachedOnOpen).toBe(true);
      expect(f.lifecycle.goneAfterClose).toBe(true);
      expect(f.lifecycle.closedCalls).toBe(1);
    });

    it("Escape closes the wizard and calls onClose", () => {
      expect(f.lifecycle.escapeClosed).toBe(true);
    });

    it("a click on the scrim closes the wizard and a click inside the dialog does not", () => {
      expect(f.lifecycle.insideClickKept).toBe(true);
      expect(f.lifecycle.scrimClosed).toBe(true);
    });

    it("clicking an option row's text selects or toggles its control and shows a pointer", () => {
      expect(f.rowClicks.checkToggled).toBe(true);
      expect(f.rowClicks.checkToggledBack).toBe(true);
      expect(f.rowClicks.pointer).toBe("pointer");
      expect(f.rowClicks.policyAskByText).toBe(true);
      expect(f.rowClicks.policySkipByText).toBe(true);
    });

    it("a click on a limit input or the Ask Claude button leaves the row's control unchanged", () => {
      expect(f.rowClicks.limitKeptRow).toBe(true);
      expect(f.rowClicks.askButtonKeptRow).toBe(true);
    });

    it("closing during Apply stops the run once", () => {
      expect(f.lifecycle.closedDuringApply).toBe(true);
      expect(f.lifecycle.stopCalls).toBe(1);
    });

    it("Cancel is in the footer on the loading screen and on Files, Checks, Tests, Policy and Review, and not on Apply or the unreadable screen", () => {
      for (const name of [
        "loading",
        "files",
        "checks",
        "tests",
        "policy",
        "review",
      ]) {
        expect(f.cancel[name]?.foot, name).toContain("Cancel");
      }

      for (const name of ["apply-running", "apply-done", "apply-failed"]) {
        expect((f.screens[name] as Screen).foot, name).not.toContain("Cancel");
      }
    });

    it("clicking Cancel closes the wizard once and applies nothing", () => {
      for (const name of [
        "loading",
        "files",
        "checks",
        "tests",
        "policy",
        "review",
      ]) {
        expect(f.cancel[name]?.closed, name).toBe(true);
        expect(f.cancel[name]?.closeCalls, name).toBe(1);
        expect(f.cancel[name]?.applied, name).toBe(false);
      }
    });

    it("no screen carries a time estimate", () => {
      for (const name of names) {
        const screen = f.screens[name] as Screen;

        expect(screen.text.trim().length, name).toBeGreaterThan(0);
        expect(screen.text, name).not.toMatch(
          /\d\s?(s|sec|seconds?|min|minutes?)\b|about \d|longer than/,
        );
      }
    });

    it("shows files, checks and the tests step from the committed survey", () => {
      expect(f.openCalls).toEqual(["survey+extract"]);
      expect(f.screens.files?.rows).toEqual([
        "3 TypeScript files",
        "1 files not read",
      ]);
      expect(f.screens.files?.steps[0]).toBe("files:now");
      expect(f.screens.checks?.rows).toEqual([
        "Structure - always on",
        "Structural analysis",
        "C.R.A.P.",
        "Mutation",
      ]);
      expect(
        f.screens.tests?.rows.filter((row) => row.includes("found in")),
      ).toHaveLength(3);
      expect(f.screens.tests?.env).toEqual(["RUST_LOG", "debug"]);
    });

    it("the Tests step shows a survey note", () => {
      const notes = f.screens["tests-note"]?.notes ?? [];

      expect(notes).toHaveLength(1);
      expect(notes[0]).toContain('no JaCoCo: add id("jacoco")');
    });

    it("shows Run once as a result per runner", () => {
      expect(f.screens["tests-tried"]?.runners).toEqual([
        "engine: ready",
        "app: ready",
        "tauri: ready",
      ]);
    });

    it("shows an output panel only after a not-ready runner with output", () => {
      const closed = f.screens["tried-output"];

      expect(closed?.runners).toEqual([
        "engine: ready",
        "app: ready",
        "tauri: not ready - no report",
      ]);
      expect(closed?.runnerOutputs).toEqual([
        null,
        null,
        {
          hidden: true,
          text: "engine not built",
          label: "What the command printed",
        },
      ]);
      expect(f.screens["tried-output-open"]?.runnerOutputs[2]?.hidden).toBe(
        false,
      );
      expect(f.screens["tests-tried"]?.runnerOutputs).toEqual([
        null,
        null,
        null,
      ]);
    });

    it("shows the policy choice, the running state and the two groups of cards", () => {
      expect(f.screens["policy-choice"]?.foot).toContain("Next (disabled)");
      expect(f.screens["policy-running"]?.text).toContain(
        "Claude is reading the imports",
      );
      expect(f.screens["policy-cards"]?.groups).toEqual(["Left out", "Rules"]);
      expect(f.screens["policy-cards"]?.cards).toHaveLength(4);
    });

    it("files note names what changed", () => {
      const files = f.screens["rerun-files"] as Screen;

      expect(files.rows).toHaveLength(3);
      expect(files.marks).toEqual(["Set up", "Gone"]);
      expect(files.text).toContain("New test runners: engine (engine)");
      expect(files.text).toContain(
        "Test suites whose folder is gone: legacy (legacy)",
      );
      expect(files.text).toContain("Languages with no files now: Python");
      expect(files.text).toContain("2 settings an upgrade moved.");
      expect((f.screens["calm-files"] as Screen).text).toContain(
        "Nothing has changed since setup.",
      );
    });

    it("marks the checks and the tests of a configured repository", () => {
      expect((f.screens["rerun-checks"] as Screen).marks).toEqual([
        "Set up",
        "Set up",
        "New",
      ]);

      const tests = f.screens["rerun-tests"] as Screen;

      expect(tests.marks).toEqual(["Gone", "Set up", "New", "New", "New"]);
      expect(tests.text).toContain("Remove from the config");
    });

    it("policy names uncovered folders", () => {
      const policy = f.screens["rerun-policy"] as Screen;

      expect(policy.text).toContain("Keep it as it is");
      expect(policy.text).toContain("Ask Claude to recommend changes");
      expect(policy.text).toContain("Not covered by the policy: web, tools.");
      expect((f.screens["calm-policy"] as Screen).text).not.toContain(
        "Not covered by the policy",
      );
      expect((f.screens["policy-choice"] as Screen).text).toContain(
        "Skip for now",
      );
    });

    it("an opened disclosure sits under the title at full width without moving the title or the toggle over it", () => {
      expect(f.disclosure).toEqual({
        titleWidthKept: true,
        toggleClear: true,
        detailBelowTitle: true,
        detailWiderThanTitle: true,
        detailSpansRow: true,
      });
    });

    it("review lists doctor's fixes under their own heading by title", () => {
      const review = f.screens["rerun-review"] as Screen;

      expect(review.groups).toEqual([
        "Doctor's fixes",
        "Checks",
        "Tests",
        "Policy",
      ]);
      expect(review.rows.length).toBeGreaterThan(3);
      expect(review.rows.slice(0, 3)).toEqual([
        "Settings moved to new places 1",
        "Settings moved to new places 2",
        "Two test suites share a name",
      ]);
      expect(review.rowBoxes.slice(0, 3)).toEqual([true, true, false]);
      expect(review.text).not.toContain("thresholds");
      expect(review.text).toContain("Rename one of the suites");
      expect(review.text).toContain(
        "Doctor keeps reporting this until it is fixed by hand.",
      );
      expect(review.text).not.toContain("Open Setup again to apply it later.");
      expect(review.details[0]?.label).toBe("Details");
      expect(review.details[0]?.hidden).toBe(true);
      expect(review.details[0]?.text).toBe(
        "config/sensors/thresholds was retired 1\n\nrecognizer config --unset k1",
      );
      expect(
        (f.screens["rerun-review-open"] as Screen).details[0]?.hidden,
      ).toBe(false);
      expect((f.screens["rerun-review-unticked"] as Screen).text).toContain(
        "Doctor keeps reporting this until it is fixed. Open Setup again to apply it later.",
      );
    });

    it("review with nothing to change offers Close", () => {
      const calm = f.screens["calm-review"] as Screen;

      expect(calm.rows).toHaveLength(0);
      expect(calm.text).toContain("Nothing to change.");
      expect(calm.foot).toContain("Close");
      expect(calm.foot).not.toContain("Close (disabled)");
    });

    it("final screen lists two sensor-gap problems by name", () => {
      expect(f.namedPairs).toEqual([
        ["C.R.A.P. cannot run as set up", "Run the crap help"],
        ["Mutation cannot run as set up", "Run the mutation help"],
      ]);
    });

    it('the done screen lists each remaining problem as a block under "Setup is done"', () => {
      const final = (name: string) => f.screens[`final-${name}`] as Screen;

      expect(final("one").heading).toBe("Setup is done");
      expect(final("one").text).toContain("1 thing still to fix");
      expect(final("one").text).toContain("Settings moved to new places 1");
      expect(final("one").text).toContain("Run the move 1");
      expect(final("two").heading).toBe("Setup is done");
      expect(final("two").text).toContain("2 things still to fix");
      expect(final("two").text).toContain("Settings moved to new places 2");
      expect(final("clean").heading).toBe("Setup is done");
      expect(final("clean").text).toContain(
        "Everything is set up. Doctor finds no problems.",
      );
      expect(final("clean").text).not.toContain("Run the move");
      expect(final("unavailable").heading).toBe("Updated");
      expect(final("unavailable").text).toContain("Doctor could not run.");
    });

    it("lists the changes in review and shows apply running, done and failed", () => {
      expect(
        f.screens.review?.foot.some((label) => label.startsWith("Apply ")),
      ).toBe(true);
      expect(f.screens["apply-running"]?.foot).toContain("Stop");
      expect(f.screens["apply-done"]?.heading).toBe("Setup is done");
      expect(f.screens["apply-done"]?.foot).toContain("Close");
      expect(f.screens["apply-failed"]?.heading).toBe("Setup stopped");
      expect(f.screens["apply-failed"]?.foot).toContain("Try again");
      expect(f.screens["apply-failed"]?.foot).toContain("Back to review");
    });

    describe("the done screen and the output panel", () => {
      const done = (name: string) => f.done[name] as DoneFact;

      it("the summary callout has the same gap below it as between rows", () => {
        const two = done("two");

        expect(two.rowCount).toBeGreaterThanOrEqual(2);
        expect(two.calloutAboveRows).toBe(true);
        expect(Math.abs(two.gapBelowCallout - two.gapBetweenRows)).toBeLessThan(
          1,
        );
      });

      it("the done screen shows the still-to-fix callout with a button only on a fixable problem", () => {
        const two = done("two");

        expect(two.heading).toBe("Setup is done");
        expect(two.lead).toBe("2 things still to fix");
        expect(two.calloutClass).toContain("warn");
        expect(two.calloutClass).not.toContain("ok");
        expect(two.blocks.map((b) => b.bold)).toEqual([
          "Settings moved to new places 1",
          "Two test suites share a name",
        ]);
        expect(two.blocks.map((b) => b.button)).toEqual(["Fix it", null]);
        expect(two.blocks.map((b) => b.orRun)).toEqual([true, false]);
        expect(two.blocks[0]?.text).toContain("Run the move 1");
        expect(two.lastLine).toBe("The changes are live in this window.");
      });

      it("the log sentence appears once on the done screen, in the footer and in no card", () => {
        for (const name of ["two", "fixed", "green", "clean"]) {
          const found = done(name).logSentence;

          expect(found.inFooter).toBe(1);
          expect(found.inBody).toBe(0);
          expect(found.inCards).toBe(0);
          expect(found.inModal).toBe(1);
        }
      });

      it("a fix whose text is its command shows the command once", () => {
        expect(f.done.sameText.mentions).toBe(1);
        expect(f.done.sameText.blocks[0]?.orRun).toBe(true);
      });

      it("pressing a fix button shows Running... then Fixed and drops the count", () => {
        const running = done("running");
        const fixed = done("fixed");

        expect(running.blocks[0]?.button).toBe("Running...");
        expect(running.buttonsDisabled).toEqual([true, true]);
        expect(fixed.blocks[0]?.text).toBe(
          "Fixed: Settings moved to new places 1",
        );
        expect(fixed.blocks[0]?.button).toBeNull();
        expect(fixed.lead).toBe("1 thing still to fix");
        expect(fixed.blocks[1]?.button).toBe("Fix it");
        expect(f.done.appliedByFix).toEqual([
          { fixes: ["recognizer config --unset k1"] },
        ]);
        expect(f.done.fixedCalls).toBe(2);
      });

      it("the callout turns green when the last problem is fixed", () => {
        const green = done("green");

        expect(green.calloutClass).toContain("ok");
        expect(green.lead).toBe(
          "Everything is set up. Doctor finds no problems.",
        );
        expect(green.lastLine).toBe("The changes are live in this window.");
        expect(green.blocks.map((b) => b.button)).toEqual([null, null]);
      });

      it("a fix that leaves the problem in the report shows it as not fixed", () => {
        const stuck = done("stuck");

        expect(stuck.blocks[0]?.text).toContain("Could not fix this");
        expect(stuck.blocks[0]?.button).toBe("Fix it");
        expect(stuck.lead).toBe("1 thing still to fix");
      });

      it("the unregistered-plugin fix registers the plugin through the plugins choice", () => {
        expect(f.done.pluginApplied).toEqual({ plugins: ["claude"] });
        expect(f.done.pluginButton).toBe("Register it");
      });

      it("an all-clear apply shows the green callout", () => {
        const clean = done("clean");

        expect(clean.calloutClass).toContain("ok");
        expect(clean.lead).toBe(
          "Everything is set up. Doctor finds no problems.",
        );
        expect(f.screens["apply-done"]?.text).toContain(
          "Everything is set up. Doctor finds no problems.",
        );
      });

      it("the output panel is closed on a successful row and open on a failed one", () => {
        const first = f.done.panels[0] as CardFact;
        const panel = first.panel as PanelFact;

        expect(panel.label).toBe("What the check printed (3 lines)");
        expect(panel.state).toBe("closed");
        expect(panel.hidden).toBe(true);
        expect(panel.chevron).toBe(true);
        expect(panel.chevronSize).toBe(16);
        expect(panel.turned).toBe(false);
        expect(panel.belowMain).toBe(true);
        expect(panel.spansCard).toBe(true);
        expect(panel.ruled).toBe(true);
        expect(panel.maxHeight).toBe("180px");
        expect(f.done.opened).toBe("open");

        const rows = f.done.failed.rows;
        const failed = rows.find((r) =>
          r.cls.includes("state-failed"),
        ) as CardFact;
        const succeeded = rows[0] as CardFact;

        expect(failed.panel?.label).toBe("What the command printed");
        expect(failed.panel?.state).toBe("open");
        expect(failed.panel?.hidden).toBe(false);
        expect(failed.panel?.turned).toBe(true);
        expect(failed.border).not.toBe(succeeded.border);
        expect(
          rows.slice(2).every((r) => r.text.includes("- not applied")),
        ).toBe(true);
        expect(f.done.failed.heading).toBe("Setup stopped");
        expect(f.done.failed.bar).toContain("failed");
        expect(f.done.failed.calloutClass).toContain("bad");
        expect(f.done.failed.callout).toContain(
          "failed, so nothing was changed.",
        );
        expect(f.done.failed.callout).toContain(
          "The changes before it were undone. Its output is open below.",
        );
      });

      it("the Checks-step Details uses the same output panel", () => {
        for (const name of ["rerun-review"]) {
          const panels = (f.screens[name]?.details ?? []).filter(
            (d) => d !== null,
          );

          expect(panels.length).toBeGreaterThan(0);

          for (const one of panels) {
            expect(one.chevron).toBe(true);
            expect(one.state).toBe("closed");
          }
        }

        expect(
          f.screens["rerun-review"]?.details.find((d) => d !== null)?.label,
        ).toBe("Details");
      });
    });
  },
);
