import { beforeAll, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../../tools/scripts/pool-scale.mjs";
import { collectFacts, FAKE_WORKER, here, webkit } from "../../src/look-page";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { loadedOf, registeredOf, scanHostOf, mountExplorer } from ${JSON.stringify(here("../test/unit/look-support.ts"))};
import { fakeViews } from ${JSON.stringify(here("../test/unit/views-fake.ts"))};
import { fakeSensors } from ${JSON.stringify(here("sensors-fake.ts"))};
import { fakeEditor } from ${JSON.stringify(here("editor-fake.ts"))};
import { fakeResponsibilities } from ${JSON.stringify(here("responsibilities-fake.ts"))};
import { fakeScan, planFromFacts } from ${JSON.stringify(here("scan-fake.ts"))};
import REASONS from ${JSON.stringify(here("../../../fixtures/sensor-reasons/states.json"))};
import { buildFooter } from ${JSON.stringify(here("footer-view.ts"))};
import { createRescanner } from ${JSON.stringify(here("rescanner.ts"))};
import { fakeRunSnapshot } from ${JSON.stringify(here("run-snapshot-fake.ts"))};
import { scansCommit } from ${JSON.stringify(here("scans-commit.ts"))};
import { withSensors } from ${JSON.stringify(here("sensor-run.ts"))};
import { NO_CHANGES } from ${JSON.stringify(here("footer-scan.ts"))};
import { createChangesHandler } from ${JSON.stringify(here("scan-changes.ts"))};
import { describerRegistered, rowSensors } from ${JSON.stringify(here("scan-panel-model.ts"))};
import { PANEL_LIMITS } from ${JSON.stringify(here("panel-widths.ts"))};
${FAKE_WORKER}

const ids = ["app/a.py", "app/b.py"];
const scan = {
  commit: "cur1234",
  modules: ids.map((id) => ({ id, kind: "module", members: id === "app/a.py" ? [{ name: "f", exported: true, kind: "function" }, { name: "g", exported: true, kind: "function" }] : [{ name: "h", exported: true, kind: "function" }] })),
  edges: [{ from: ids[0], to: ids[1], kind: "depends", line: 1, names: ["X"] }],
  foreign: [],
  files: [{ path: "app/a.py", hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }, { path: "app/b.py", hash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }],
};
const base = loadedOf({ modules: ids, scans: [{ file: "scan.python.json", scan }] });
const INSTALLED = [
  { name: "crap", display: "C.R.A.P.", description: "Runs the tests with coverage.", expansion: "C.R.A.P.: Change Risk Anti-Patterns.", runsTests: true, scoped: false, listed: true, metrics: [], findings: [], settings: [] },
  { name: "mutation", display: "Mutation", description: "Mutates and tests.", runsTests: true, scoped: true, plannedWork: { verb: "mutate" }, logPath: ".recognizer/cache/coverage/last-run.log", listed: true, metrics: [], findings: [], settings: [] },
];
const CONFIG = "describer:\\n  command: [describer, '{request}']\\n  version: v1\\nsensors:\\n  crap:\\n    manifest: [recognizer-sense-crap, manifest]\\n  mutation:\\n    manifest: [recognizer-sense-mutation, manifest]\\n  tally:\\n    command: [node, '{repository}/t.mjs', '{commit}', '{output}']\\n  alpha:\\n    command: [node, '{repository}/a.mjs', '{commit}', '{output}']\\n  beta:\\n    command: [node, '{repository}/b.mjs', '{commit}', '{output}']\\n";
const FILES = { states: {}, describedAtMs: null };
const ORIGIN = { branch: "main", commit: "cur1234" };
const json = (value) => JSON.stringify(value);
const current = { kind: "extract-current" };
const describing = (total) => ({ kind: "plugin-started", name: "describe", progress: { done: 0, total, unit: "files" }, phase: "describe" });
const sensing = (total) => ({ kind: "structure", state: "done", files: 0 });
const entry = (phase, name, reason) => phase === "describe" ? { kind: "plugin-item", name: "describe", item: name, ok: reason === undefined, reason: reason ?? "", phase: "describe" } : reason === undefined ? { kind: "plugin-ended", name, state: "finished" } : { kind: "plugin-ended", name, state: "failed", failure: { reason, diagnosis: null } };
const summary = { kind: "summary", exit: 0, log: null };
const gate = () => { let release = () => {}; const promise = new Promise((resolve) => { release = resolve; }); return { promise, release }; };

const structureFor = (loaded) => { const { commit, modified } = scansCommit(loaded.repository); return commit === null ? null : JSON.stringify({ findings_version: 1, sensor: { name: "structure", version: "1" }, commit, modified, settings: { duplication: { threshold: 0.8, min_lines: 4, pair_min_lines: 6, min_nodes: 20 }, complexity_limit: 10 }, findings: [] }); };

const tick = () => new Promise((resolve) => setTimeout(resolve, 60));
const until = async (ready, what) => { for (let waited = 0; !ready(); waited += 5) { if (waited >= 20000) throw new Error("timed out waiting for " + what); await new Promise((resolve) => setTimeout(resolve, 5)); } };
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

async function mount(fake, given = undefined, scanned = true, viewFiles = {}, files = FILES, planGate = undefined) {
  const sensors = given ?? fakeSensors({}, { config: CONFIG }, {}, INSTALLED);
  const sensed = (loaded) => { const text = scanned ? structureFor(loaded) : null; if (text !== null) sensors.files.set("structure", text); return withSensors(loaded, sensors); };
  for (const old of document.querySelectorAll(".mount-root")) old.remove();
  const root = document.createElement("div");
  root.className = "mount-root";
  const host = document.createElement("div");
  host.style.cssText = "width:1400px;height:700px;display:flex;flex-direction:column";
  const footerEl = document.createElement("div");
  footerEl.className = "footer";
  root.append(host, footerEl);
  document.body.append(root);
  const editor = fakeEditor();
  const responsibilities = fakeResponsibilities(files);
  const wired = { tray: [], useRunView: false, posted: [], explorer: null, current: null, scanState: null, scanning: null, rescanner: null };
  const withProgress = (state) => ({ ...state, scanning: wired.scanning });
  const footer = buildFooter(footerEl);
  const scanHost = scanHostOf({
    port: sensors,
    estimate: (request) => fake.estimate(request),
    plan: (request, facts) => (planGate === undefined ? planFromFacts(request, facts) : planGate.promise.then(() => planFromFacts(request, facts))),
    scan: () => wired.scanState,
    ticks: () => wired.rescanner.ticks(),
    setTicks: (next) => wired.rescanner.setTicks(next),
    changeTicks: (ticks, changes) => fake.changeTicks(ticks, changes),
    runState: () => wired.rescanner.runState(),
    running: () => wired.rescanner.running(),
    run: (modules, planned) => void wired.rescanner.run(modules, planned),
    stop: () => void wired.rescanner.stop(),
    runView: () => (wired.useRunView ? wired.rescanner.runView() : null),
    refresh: () => void wired.rescanner.refresh(),
    footer: (text) => footer.setScan(text),
    progressText: () => wired.scanning,
    describeProgress: () => { const d = wired.rescanner.progress().describe; return d === null ? null : { entries: d.done, total: d.total }; },
    sensorProgress: () => wired.rescanner.progress().sensorProgress,
    extracting: () => wired.rescanner.progress().extract === "run",
  });
  const build = (loaded, carried) => {
    wired.current = loaded;
    wired.views = fakeViews(viewFiles);
    return mountExplorer({ container: host, loaded, title: "demo", views: wired.views, post: (input) => { wired.posted.push(input); return null; }, carried, storage: { getItem: () => null, setItem: () => {} }, editor, responsibilities, scanHost });
  };
  const setScan = (next) => { wired.scanState = next; };
  wired.rescanner = createRescanner({
    port: fake,
    snapshot: fakeRunSnapshot(fake),
    registered: async () => { const { config } = await sensors.inputs(); return registeredOf(rowSensors(config, await sensors.sensorList()), describerRegistered(config)); },
    load: () => base,
    sense: (loaded) => sensed(loaded),
    resense: async () => sensed(wired.current),
    adopt: async () => ORIGIN,
    carry: () => wired.explorer?.carry() ?? null,
    replace: (loaded, carried) => { wired.explorer?.dispose(); wired.explorer = build(loaded, carried); },
    update: (loaded) => { if (wired.explorer === null) return false; wired.current = loaded; wired.explorer.update(loaded); return true; },
    adopted: (origin) => setScan(withProgress({ origin, scannedAt: Date.now(), changes: NO_CHANGES })),
    describedLine: () => wired.explorer?.refreshResponsibilities(),
    progress: (update) => { wired.scanning = update.scanning; if (wired.scanState !== null) setScan(withProgress(wired.scanState)); wired.explorer?.refreshPanel(); },
    settled: () => {},
    hasExplorer: () => wired.explorer !== null,
    blocked: (text) => { footer.post({ kind: "error", text: "Rescan failed: " + text }); },
    post: (input) => { if (/^Scan (started|complete|failed|refused)/.test(input.text)) return null; wired.tray.push(input); return footer.post(input); },
    attach: (id, extra) => footer.attach(id, extra),
    openLog: (log) => { void editor.openFile(log); },
    show: (target) => wired.explorer.show(target),
  });
  wired.changesChanged = createChangesHandler({ state: () => wired.scanState, setState: setScan, refreshPanel: () => wired.explorer?.refreshPanel() });
  await wired.rescanner.loadTicks();
  wired.current = base;
  setScan(withProgress({ origin: ORIGIN, scannedAt: Date.now(), changes: NO_CHANGES }));
  wired.explorer = build(await sensed(base), null);
  await tick();

  const q = (selector) => root.querySelector(selector);
  const all = (selector) => [...root.querySelectorAll(selector)];
  const visible = (selector) => { const n = q(selector); return n !== null && getComputedStyle(n).display !== "none"; };
  const rows = () => all(".scan-row:not(.scan-suite)").map((r) => ({ key: r.dataset.sensor, name: r.querySelector(".scan-row-label").textContent, state: r.querySelector(".scan-state-text").textContent, note: (() => { const last = r.querySelector(".scan-state").title.split(": ").pop(); return /^(stopped|skipped)/.test(last) ? last : null; })(), tone: r.querySelector(".scan-state").className.replace("scan-state", "").trim(), color: getComputedStyle(r.querySelector(".scan-state")).color, title: r.dataset.tip, ticked: r.querySelector(".scan-tick").checked, disabled: r.querySelector(".scan-tick").disabled, accent: getComputedStyle(r.querySelector(".scan-tick")).accentColor, spinner: r.querySelectorAll(".scan-state .scan-spin").length, logLink: r.querySelector(".scan-log-link")?.textContent ?? null, bar: r.querySelectorAll(".scan-bar").length }));
  const text = (selector) => q(selector)?.textContent ?? "<missing " + selector + ">";
  const scanLineText = () => q(".scan-line").textContent;
  const footerButtons = () => all(".footer button").filter((b) => !b.closest(".message-tray, .message-toast")).map((b) => b.className);
  const messages = () => all(".message-list .msg").map((m) => ({ text: m.querySelector(".msg-text").textContent, actions: [...m.querySelectorAll(".msg-act")].map((b) => b.textContent) }));
  const message = (contains) => all(".message-list .msg").find((m) => m.querySelector(".msg-text").textContent.includes(contains));
  const act = (contains, label) => click([...message(contains).querySelectorAll(".msg-act")].find((b) => b.textContent === label));
  const setTick = async (key, checked) => { const box = q('.scan-row[data-sensor="' + key + '"] .scan-tick'); box.checked = checked; box.dispatchEvent(new Event("change", { bubbles: true })); await tick(); };
  const panel = () => ({ header: q(".scan-sub").textContent, amber: q(".scan-sub .warn")?.textContent ?? null, amberColor: q(".scan-sub .warn") ? getComputedStyle(q(".scan-sub .warn")).color : null, rows: rows(), buttons: all(".scan-buttons button").map((b) => ({ text: b.textContent, disabled: b.disabled, spinner: b.querySelectorAll("svg").length })), summary: q(".summary") ? { shape: q(".summary").dataset.shape, tone: q(".summary").className.replace("summary", "").trim(), head: q(".summary-head").textContent, line: q(".summary-line").textContent, bar: all(".summary-bar").length, spinning: q(".summary .scan-spin") !== null } : null, rowBars: all(".scan-bar").length, strays: all(".scan-block, .scan-block-title, .sensor-add, .sensor-remove, .scan-summary, .scan-stop-button, .scan-panel h2, .scan-panel h3, .scan-extract, .scan-describe, .measure-row").length, subLines: all(".scan-row *").filter((n) => n.matches("div")).length });

  const markScanned = () => { scanned = true; };
  const showRunView = () => { wired.useRunView = true; };
  return { host, q, all, visible, rows, markScanned, showRunView, text, scanLineText, footerButtons, messages, act, setTick, panel, fake, editor, wired, sensors, emitChangesChanged: (changes) => wired.changesChanged(changes) };
}

(async () => {
  const facts = {};

  const fake = fakeScan();
  const a = await mount(fake, undefined, false);
  click(a.q(".rail-scan"));
  await tick();
  facts.fresh = { ...a.panel(), order: a.all(".rail button").map((b) => b.className.split(" ")[1]), railLabel: getComputedStyle(a.q(".rail-scan"), "::after").content, files: a.visible(".tree-header"), panelOpen: a.visible(".scan-panel"), ran: fake.ran.length, buttonTitle: a.q(".scan-run").title };

  const rowEls = a.all(".scan-row:not(.scan-suite)");
  const first = rowEls[0].querySelector(".scan-state");
  first.textContent = "155 files described, 34 minutes ago";
  const paneBox = a.q(".scan-panel").getBoundingClientRect();
  const paneStyle = getComputedStyle(a.q(".scan-panel"));
  const contentRight = paneBox.right - parseFloat(paneStyle.paddingRight);
  const stateBox = first.getBoundingClientRect();
  const lineHeight = parseFloat(getComputedStyle(first).lineHeight) || 16;
  const lastRow = rowEls[rowEls.length - 1];
  lastRow.dispatchEvent(new MouseEvent("mouseenter"));
  const tipBox = document.querySelector(".scan-tip").getBoundingClientRect();
  facts.long = { stateRight: stateBox.right, contentRight, lines: Math.round(stateBox.height / lineHeight), nameOverflow: rowEls[0].querySelector(".scan-row-label").scrollWidth > rowEls[0].querySelector(".scan-row-label").clientWidth, tip: { left: tipBox.left, top: tipBox.top, right: tipBox.right, bottom: tipBox.bottom }, viewport: { w: window.innerWidth, h: window.innerHeight } };
  lastRow.dispatchEvent(new MouseEvent("mouseleave"));

  const b = await mount(fake);
  click(b.q(".rail-scan"));
  await tick();
  facts.scanned = b.panel();
  await b.setTick("describe", true);
  await b.setTick("tally", true);
  await b.setTick("crap", true);
  facts.ticked = { rows: b.rows().filter((r) => r.ticked).map((r) => r.key), written: fake.written.at(-1) };

  const c = await mount(fake);
  click(c.q(".rail-scan"));
  await tick();
  facts.reopened = c.rows().filter((r) => r.ticked).map((r) => r.key);

  const g1 = gate(); const g2 = gate(); const g3 = gate();
  const startLine = (name) => ({ kind: "plugin-started", name, progress: null });
  fake.steps = [current, describing(1), entry("describe", "app/a.py"), g1.promise, sensing(2), startLine("tally"), g2.promise, entry("sense", "tally"), startLine("crap"), g3.promise, entry("sense", "crap"), summary];
  const during = [];
  const duringFooter = [];
  fake.onStep = (index) => { if ([1, 3, 5, 8].includes(index)) { during.push(c.panel()); duringFooter.push({ text: c.scanLineText(), buttons: c.footerButtons() }); } if (index === 6) c.sensors.files.set("tally", json({ findings_version: 1, sensor: { name: "tally", version: "1" }, commit: "cur1234", modified: false, settings: {}, inputs: { "app/a.py": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "app/b.py": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }, findings: [] })); };
  await c.setTick("describe", true);
  await c.setTick("crap", true);
  const realRun = fake.run;
  const firstRun = gate();
  fake.run = async (plan) => { await firstRun.promise; return realRun.call(fake, plan); };
  click(c.q(".scan-run"));
  await tick();
  const heldSamples = during.length;
  const heldPlans = fake.ran.length;
  firstRun.release();
  await until(() => during.length > 0, "the first scan sample");
  fake.run = realRun;
  facts.run = { plans: fake.ran, heldSamples, heldPlans, first: during[0] ?? null, footer: duringFooter[0] ?? null };
  facts.run.second = await fake.run({ describe: false, sense: [] });
  g1.release();
  await until(() => during.length >= 3, "the sample after the describe step");
  facts.run.afterDescribe = c.panel();
  g2.release();
  await until(() => during.length >= 4, "the sample after the duplication step");
  facts.run.afterDuplication = c.panel();
  g3.release();
  await until(() => c.q(".scan-stop") === null, "the scan to finish");
  facts.run.after = c.panel();
  facts.run.footerAfter = { text: c.scanLineText(), buttons: c.footerButtons() };
  facts.run.written = fake.written.map((w) => w.ticked);
  facts.run.crapTickAfter = c.rows().find((r) => r.key === "crap").ticked;

  const stopGate = gate();
  const sfake = fakeScan({ steps: [current, describing(2), stopGate.promise] });
  const s = await mount(sfake);
  click(s.q(".rail-scan"));
  await tick();
  await s.setTick("describe", true);
  click(s.q(".scan-run"));
  await tick();
  facts.stopWhileRunning = { count: s.all(".scan-buttons .scan-stop").length, buttons: s.panel().buttons, order: s.all(".scan-buttons button").map((b) => b.className.split(" ")[0]) };
  facts.modeWhileRunning = { disabled: s.all(".scan-run-mode button").map((b) => b.disabled), stopEnabled: s.q(".scan-stop").disabled === false };
  const tickedBefore = s.rows().map((r) => r.ticked);
  s.all(".scan-row-label").forEach((label) => click(label));
  await tick();
  facts.ticksWhileRunning = { disabled: s.rows().map((r) => r.disabled), unchanged: s.rows().map((r) => r.ticked).join() === tickedBefore.join(), stopEnabled: s.q(".scan-stop").disabled === false };
  click(s.q(".scan-stop"));
  await tick(); await tick();
  facts.ticksAfterStop = s.rows().map((r) => r.disabled);
  facts.stop = { footer: s.scanLineText(), footerButtons: s.footerButtons(), stopAfter: s.all(".scan-stop").length, button: s.q(".scan-run")?.textContent ?? "", disabled: s.q(".scan-run")?.disabled };

  const changed = await mount(fakeScan());
  changed.wired.scanState = { ...changed.wired.scanState, scannedAt: Date.now() - 2 * 3600000, changes: NO_CHANGES };
  click(changed.q(".rail-scan"));
  await tick();
  facts.changedBefore = changed.panel();
  changed.emitChangesChanged({ files: [{ path: "app/a.py", kind: "modified" }], moved: null });
  await tick();
  facts.changed = changed.panel();

  const failFake = fakeScan({
    defaults: { describe: false, sensors: true },
    steps: [current, sensing(1), entry("sense", "tally", "broke"), { kind: "summary", exit: 1, log: "x-scan" }],
    result: { status: "finished", exitCode: 1 },
  });
  const t = await mount(failFake);
  click(t.q(".rail-scan"));
  await tick();
  click(t.q(".scan-run"));
  await tick(); await tick();
  facts.failed = { ...t.panel(), posted: t.wired.tray.filter((p) => p.kind === "error" && p.text.includes("failed")).map((p) => p.text) };
  click(t.q(".rail-files"));
  await tick();
  const failedFooter = { text: t.scanLineText(), buttons: t.footerButtons() };
  const messagesBefore = t.messages();
  const hiddenBefore = !t.visible(".scan-panel");
  t.act("tally failed", "Show");
  await tick();
  const dot = t.q(".rail-scan .rail-dot");
  t.act("tally failed", "Open log");
  await tick();
  facts.sensorFail = {
    footer: failedFooter,
    messages: messagesBefore,
    hiddenBefore,
    panelOpen: t.visible(".scan-panel"),
    dot: dot !== null && !dot.hidden && getComputedStyle(dot).display !== "none",
    opened: t.editor.files,
    reasonLines: t.all(".scan-row").map((r) => r.querySelectorAll("div").length).reduce((a, b) => a + b, 0),
  };

  const bareFake = fakeScan({
    defaults: { describe: false, sensors: true },
    steps: [current, sensing(1), entry("sense", "tally", "broke"), summary],
    result: { status: "finished", exitCode: 1 },
  });
  const bare = await mount(bareFake);
  click(bare.q(".rail-scan"));
  await tick();
  click(bare.q(".scan-run"));
  await tick(); await tick();
  facts.noLog = bare.messages();

  const moduleFake = fakeScan({
    defaults: { describe: true, sensors: false },
    steps: [current, describing(2), entry("describe", "app/a.py", "no describer"), entry("describe", "app/b.py", "no describer"), { kind: "summary", exit: 1, log: "y-scan" }],
    result: { status: "finished", exitCode: 1 },
  });
  const m = await mount(moduleFake);
  click(m.q(".rail-scan"));
  await tick();
  click(m.q(".scan-run"));
  await tick(); await tick();
  click(m.q(".rail-files"));
  await tick();
  const moduleFooter = { text: m.scanLineText(), buttons: m.footerButtons() };
  const moduleMessages = m.messages();
  m.act("Describe wrote", "Show");
  await tick();
  facts.moduleFail = {
    footer: moduleFooter,
    messages: moduleMessages,
    header: m.q(".inspector")?.textContent ?? "",
    reason: m.q(".responsibility .finding.warning")?.textContent ?? "",
  };
  facts.missing = { text: m.q(".responsibility .muted, .responsibility .line")?.textContent ?? "", describe: m.all(".responsibility .describe").length };

  const downSensors = fakeSensors({}, { config: CONFIG }, {}, { status: "unavailable", reason: "recognizer is not installed" });
  const down = await mount(fakeScan(), downSensors);
  click(down.q(".rail-scan"));
  await tick();
  facts.down = down.rows().map((r) => ({ name: r.name, disabled: r.disabled }));

  const pendingGate = gate();
  const slowSensors = fakeSensors({}, { config: CONFIG }, {}, INSTALLED);
  const instantInstalled = slowSensors.sensorList.bind(slowSensors);
  slowSensors.sensorList = async () => { await pendingGate.promise; return instantInstalled(); };
  const slow = await mount(fakeScan(), slowSensors);
  click(slow.q(".rail-scan"));
  await tick();
  facts.pending = { header: slow.q(".scan-sub").textContent, rows: slow.rows().length, buttons: slow.all(".scan-buttons button").length, list: slow.q(".scan-list").children.length };
  pendingGate.release();
  await tick();
  facts.loaded = { rows: slow.rows().map((r) => r.name), buttons: slow.all(".scan-buttons button").length };

  const REPORT = json({ findings_version: 1, sensor: { name: "review", version: "reported" }, commit: "feed123abc", modified: false, settings: {}, reported_at: new Date(Date.now() - 3 * 60000).toISOString(), findings: [] });
  const reportSensors = fakeSensors({ review: REPORT }, { config: CONFIG }, {}, INSTALLED);
  const rp = await mount(fakeScan(), reportSensors);
  click(rp.q(".rail-scan"));
  await tick();
  const reportRow = () => rp.q('.sensor-row.reported[data-sensor="review"]');
  facts.report = {
    names: rp.rows().map((r) => r.name),
    listCount: rp.all(".scan-row").length,
    ticks: reportRow()?.querySelectorAll("input").length ?? null,
    chip: reportRow()?.querySelector(".sensor-chip").textContent ?? "",
    commit: reportRow()?.querySelector(".sensor-commit").textContent ?? "",
    clear: reportRow()?.querySelector(".sensor-clear")?.textContent ?? "",
    afterList: reportRow() !== null && rp.all(".scan-row").at(-1).compareDocumentPosition(reportRow()) === Node.DOCUMENT_POSITION_FOLLOWING,
  };
  click(reportRow().querySelector(".sensor-clear"));
  await tick(); await tick();
  facts.reportCleared = { removed: [...reportSensors.removed], present: reportRow() !== null };

  const viewJson = (steps) => JSON.stringify({ schema_version: 4, description: "Shows a.", commit: "cur1234", steps }, null, 2) + "\\n";
  const scopeFake = fakeScan();
  const sc = await mount(scopeFake, undefined, true, { demo: viewJson([{ kind: "pick", module: "app/a.py" }]) });
  click(sc.q(".rail-scan"));
  await tick();
  const scopeOf = () => ({ switches: sc.all(".scan-scope").length, caption: sc.q(".scan-scope-canvas")?.textContent ?? null, on: sc.q(".scan-scope-canvas")?.getAttribute("aria-pressed") ?? null, all: sc.q(".scan-scope-all")?.textContent ?? null, disabled: sc.q(".scan-scope-canvas")?.disabled ?? null });
  const stateOf = (key) => sc.rows().find((r) => r.key === key)?.state;
  const noteOf = (key) => sc.rows().find((r) => r.key === key)?.note;
  facts.scopeNone = { scope: scopeOf(), describe: stateOf("describe") };
  click(sc.q(".rail-files"));
  await tick();
  click(sc.q(".reye"));
  await tick();
  click(sc.q(".rail-scan"));
  await tick();
  facts.scopeUntitled = { scope: scopeOf(), describe: stateOf("describe") };
  click(sc.q(".scan-scope-canvas"));
  await tick();
  facts.scopeUntitledOn = { scope: scopeOf(), describe: stateOf("describe") };
  click(sc.q(".scan-scope-all"));
  await tick();
  click(sc.q(".view-list"));
  await tick();
  const item = sc.all(".view-item").find((n) => n.querySelector(".view-item-name").textContent === "demo");
  click(item);
  await tick(); await tick();
  click(sc.q(".rail-scan"));
  await tick();
  await sc.setTick("mutation", true);
  facts.scopeOff = { scope: scopeOf(), describe: stateOf("describe"), mutation: stateOf("mutation"), mutationNote: noteOf("mutation"), crap: stateOf("crap"), duplication: stateOf("tally") };
  click(sc.q(".scan-scope-canvas"));
  await tick();
  facts.scopeOn = { scope: scopeOf(), describe: stateOf("describe"), mutation: stateOf("mutation"), mutationNote: noteOf("mutation"), crap: stateOf("crap"), duplication: stateOf("tally"), written: scopeFake.written.at(-1) };
  const hold = gate();
  scopeFake.steps = [hold.promise];
  click(sc.q(".scan-run"));
  await tick();
  facts.scopeRunning = scopeOf();
  hold.release();
  await tick(); await tick();
  facts.scopeRan = { modules: scopeFake.ran.map((plan) => plan.modules), after: scopeOf() };
  click(sc.q(".scan-scope-all"));
  await tick();
  click(sc.q(".scan-run"));
  await tick(); await tick();
  facts.scopeOffRan = scopeFake.ran.map((plan) => plan.modules);

  const emptyFake = fakeScan();
  const em = await mount(emptyFake, undefined, true, { demo: viewJson([]) });
  click(em.q(".rail-files"));
  await tick();
  click(em.q(".view-list"));
  await tick();
  click(em.all(".view-item").find((n) => n.querySelector(".view-item-name").textContent === "demo"));
  await tick(); await tick();
  click(em.q(".rail-scan"));
  await tick();
  await em.wired.rescanner.setTicks({ ...em.wired.rescanner.ticks(), onlyView: true });
  await tick(); await tick();
  const emptyScope = () => ({ canvasDisabled: em.q(".scan-scope-canvas")?.disabled ?? null, canvasTitle: em.q(".scan-scope-canvas")?.title ?? null, canvasPressed: em.q(".scan-scope-canvas")?.getAttribute("aria-pressed") ?? null, allPressed: em.q(".scan-scope-all")?.getAttribute("aria-pressed") ?? null, allDisabled: em.q(".scan-scope-all")?.disabled ?? null, caption: em.q(".scan-scope-canvas")?.textContent ?? null });
  facts.emptyCanvas = emptyScope();
  const writtenBefore = emptyFake.written.length;
  em.q(".scan-scope-canvas").click();
  await tick();
  facts.emptyCanvasClick = { writes: emptyFake.written.length - writtenBefore };
  const beforeIdle = { ran: emptyFake.ran.length, written: emptyFake.written.length };
  facts.idleButton = { label: em.q(".scan-run").textContent, disabled: em.q(".scan-run").disabled, text: em.q(".scan-panel").textContent };
  em.q(".scan-run").click();
  await tick(); await tick();
  facts.idleClick = { ran: emptyFake.ran.length - beforeIdle.ran, written: emptyFake.written.length - beforeIdle.written };
  click(em.q(".scan-run-mode-full"));
  await tick();
  click(em.q(".scan-run"));
  await tick(); await tick();
  facts.emptyCanvasRun = { modules: emptyFake.ran.map((plan) => plan.modules), onlyView: em.wired.rescanner.ticks().onlyView };

  const BAD_CONFIG = CONFIG.replace("manifest: [recognizer-sense-crap, manifest]", "manifest: [recognizer-sense-crap, manifest]\\n    timeout_factor: 2");
  const broken = await mount(fakeScan(), fakeSensors({}, { config: BAD_CONFIG }, {}, INSTALLED));
  click(broken.q(".rail-scan"));
  await tick();
  const brokenRow = broken.q('.scan-row[data-sensor="crap"]');
  const reasonEl = brokenRow.querySelector(".scan-row-reason");
  const reasonBox = reasonEl.getBoundingClientRect();
  const brokenPane = broken.q(".scan-panel");
  const brokenPaneStyle = getComputedStyle(brokenPane);
  const brokenText = reasonEl.textContent;
  facts.settingsError = {
    label: brokenRow.querySelector(".scan-state-text").textContent,
    reason: brokenText,
    occurrences: brokenText.split("timeout_factor").length - 1,
    fitsRight: reasonBox.right <= brokenPane.getBoundingClientRect().right - parseFloat(brokenPaneStyle.paddingRight) + 0.5,
    unclipped: reasonEl.scrollWidth <= reasonEl.clientWidth,
    belowLabel: reasonBox.top >= brokenRow.querySelector(".scan-row-label").getBoundingClientRect().bottom - 0.5,
  };

  const crapDoc = (hashes) => json({ findings_version: 1, sensor: { name: "crap", version: "1" }, commit: "cur1234", modified: false, settings: {}, inputs: hashes, findings: [] });
  const fsensors = fakeSensors({}, { config: CONFIG }, {}, INSTALLED);
  fsensors.files.set("crap", crapDoc({ "app/a.py": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "app/b.py": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" }));
  for (const name of ["tally", "mutation", "alpha", "beta"]) fsensors.files.set(name, json({ findings_version: 1, sensor: { name, version: "1" }, commit: "cur1234", modified: false, settings: {}, inputs: { "app/a.py": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "app/b.py": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }, findings: [] }));
  const lineOf = { kind: "current", line: "Does a thing." };
  const described = { states: { "app/a.py": lineOf, "app/b.py": lineOf }, describedAtMs: null };
  const fr = await mount(fakeScan(), fsensors, true, {}, described);
  click(fr.q(".rail-scan"));
  await tick();
  await fr.setTick("crap", true);
  const freshFacts = () => ({ summary: fr.panel().summary, rows: fr.rows().filter((r) => r.key === "crap").map((r) => ({ state: r.state, note: r.note })), rowBars: fr.all(".scan-bar, .summary-bar").length, button: fr.q(".scan-run")?.textContent ?? null, disabled: fr.q(".scan-run")?.disabled ?? null, secondary: fr.all(".scan-secondary").length, mode: fr.q(".scan-run-mode .on")?.textContent ?? null, modeToggles: fr.all(".scan-run-mode button").map((b) => ({ text: b.textContent, pressed: b.getAttribute("aria-pressed"), disabled: b.disabled })), oldSwitch: fr.all(".scan-mode, .scan-mode-switch").length });
  facts.freshPartial = freshFacts();
  fsensors.files.set("crap", crapDoc({ "app/a.py": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "app/b.py": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }));
  await fr.wired.rescanner.refresh();
  await tick(); await tick();
  facts.freshComplete = freshFacts();
  click(fr.q(".scan-run-mode-full"));
  await tick();
  facts.freshRescan = { ...freshFacts(), ranBefore: fr.fake.ran.length };
  click(fr.q(".scan-run-mode-incremental"));
  await tick();
  facts.freshBack = freshFacts();
  const boxOf = (n) => n.getBoundingClientRect();
  const panelEl = fr.q(".scan-panel");
  const panelStyle = getComputedStyle(panelEl);
  const layoutLastRow = fr.all(".scan-row").at(-1);
  facts.layout = {
    order: [...panelEl.children].map((n) => n.className.split(" ")[0]),
    controls: [...fr.q(".scan-controls").children].map((n) => n.className.split(" ")[0]),
    rowsBeforeControls: Boolean(layoutLastRow.compareDocumentPosition(fr.q(".scan-controls")) & Node.DOCUMENT_POSITION_FOLLOWING),
    scopeAboveMode: boxOf(fr.q(".scan-scope")).bottom <= boxOf(fr.q(".scan-run-mode")).top + 0.5,
    modeAbovePrimary: boxOf(fr.q(".scan-run-mode")).bottom <= boxOf(fr.q(".scan-run")).top + 0.5,
    runWidth: boxOf(fr.q(".scan-run")).width,
    contentWidth: panelEl.clientWidth - parseFloat(panelStyle.paddingLeft) - parseFloat(panelStyle.paddingRight),
    modeClipped: fr.q(".scan-run-mode").scrollWidth > fr.q(".scan-run-mode").clientWidth,
    secondaryCss: fr.all(".scan-secondary").length,
  };

  const ranDoc = (name, diagnosis) => json({ findings_version: 1, sensor: { name, version: "1" }, commit: "cur1234", modified: false, settings: {}, inputs: { "app/a.py": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "app/b.py": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }, findings: [], diagnosis });
  const whyFacts = (m, key) => {
    const row = m.q('.scan-row[data-sensor="' + key + '"]');
    const hover = row.querySelector(".scan-state").title;
    const at = hover.indexOf(": ");
    const rowBox = row.getBoundingClientRect();
    const next = row.nextElementSibling;
    const nextBox = next ? next.getBoundingClientRect() : null;
    const sibling = m.q('.scan-row[data-sensor="structure"]').getBoundingClientRect();
    return {
      state: m.rows().find((r) => r.key === key).state,
      tone: m.rows().find((r) => r.key === key).tone,
      why: at < 0 ? null : hover.slice(at + 2),
      beneath: row.querySelector(".scan-why") !== null,
      log: row.querySelector(".scan-log-link")?.textContent ?? null,
      oneLine: Math.abs(rowBox.height - sibling.height) < 1,
      clear: nextBox === null ? null : nextBox.top >= rowBox.bottom - 0.5,
    };
  };
  const openScan = async (m) => { click(m.q(".rail-scan")); await tick(); };
  const reasonScan = async (name, diagnosis) => {
    const lines = [current, sensing(1), { kind: "plugin-started", name, progress: null }, { kind: "plugin-ended", name, state: "failed", failure: { reason: diagnosis.line, diagnosis } }, summary];
    const m = await mount(fakeScan({ steps: lines }));
    await openScan(m);
    await m.setTick(name, true);
    click(m.q(".scan-run"));
    await tick(); await tick(); await tick();
    return m;
  };
  const completedScan = async (name, diagnosis) => {
    const m = await mount(fakeScan(), fakeSensors({ [name]: ranDoc(name, diagnosis) }, { config: CONFIG }, {}, INSTALLED));
    await openScan(m);
    return m;
  };
  facts.reasons = {};
  const crapRed = await completedScan("crap", REASONS["crap-tests-failed"]);
  facts.reasons.crapRed = whyFacts(crapRed, "crap");
  click(crapRed.q('.scan-row[data-sensor="crap"] .scan-log-link'));
  await tick();
  facts.reasons.opened = crapRed.editor.opened.map((o) => o.file);
  const crapNoCov = await completedScan("crap", REASONS["crap-no-coverage"]);
  facts.reasons.crapNoCov = whyFacts(crapNoCov, "crap");
  facts.reasons.crapNoRun = whyFacts(await reasonScan("crap", REASONS["crap-no-runner"]), "crap");
  facts.reasons.mutationRed = whyFacts(await reasonScan("mutation", REASONS["mutation-tests-failing"]), "mutation");
  facts.reasons.mutationNoCov = whyFacts(await reasonScan("mutation", REASONS["mutation-no-coverage"]), "mutation");
  facts.reasons.plain = (await (async () => { const m = await mount(fakeScan({ steps: [current, sensing(1), { kind: "plugin-ended", name: "crap", state: "failed", failure: { reason: "boom", diagnosis: null } }, summary] })); await openScan(m); await m.setTick("crap", true); click(m.q(".scan-run")); await tick(); await tick(); await tick(); return whyFacts(m, "crap"); })());

  const restart = async (refusals, modifiedMs) => {
    const f = fakeSensors({ crap: ranDoc("crap", undefined) }, { config: CONFIG }, {}, INSTALLED);
    if (modifiedMs !== undefined) f.modified.set("crap", modifiedMs);
    f.refusals = refusals;
    const m = await mount(fakeScan(), f);
    await openScan(m);
    return whyFacts(m, "crap");
  };
  const FAILED_AT = "2026-11-02T09:00:00.000Z";
  const refusalAt = (diagnosis) => ({ crap: { reason: "tests failed", diagnosis, at: Date.parse(FAILED_AT) } });
  const FAILED = refusalAt(REASONS["mutation-tests-failing"]);
  facts.restart = {
    refused: await restart(FAILED, Date.parse(FAILED_AT) - 1000),
    okNewer: await restart({}, Date.parse(FAILED_AT) - 1000),
    copy: await restart(refusalAt(REASONS["crap-no-coverage"]), Date.parse(FAILED_AT) - 1000),
    none: await restart({}, Date.parse(FAILED_AT) - 1000),
    older: await restart({}, Date.parse(FAILED_AT) + 1000),
    tie: await restart({}, Date.parse(FAILED_AT)),
  };


  const SUITE_CONFIG = CONFIG + "tests:\\n  - name: unit\\n    language: python\\n    directory: tests/unit\\n    command: pytest\\n    coverage: { path: coverage.xml, format: lcov }\\n  - name: a-suite-with-a-very-long-name-indeed\\n    language: python\\n    directory: tests/long\\n    command: pytest\\n    coverage: { path: coverage.xml, format: lcov }\\n  - name: web\\n    language: typescript\\n    directory: web\\n    runner: vitest\\n    command: vitest\\n    coverage: { path: coverage/lcov.info, format: lcov }\\n";
  const suiteDoc = (name) => json({ findings_version: 2, sensor: { name, version: "1" }, commit: "cur1234", modified: false, settings: {}, inputs: {}, findings: [], suites: [{ name: "unit", status: "ok", ran_at: new Date(Date.now() - 3 * 3600000).toISOString() }, { name: "a-suite-with-a-very-long-name-indeed", status: "failed", ran_at: new Date(Date.now() - 2 * 86400000).toISOString(), reason: "coverage unavailable" }, { name: "web", status: "never", ran_at: null }] });
  const suiteSensors = () => fakeSensors({ crap: suiteDoc("crap"), mutation: suiteDoc("mutation") }, { config: SUITE_CONFIG }, {}, INSTALLED);
  const suiteFake = fakeScan();
  const sm = await mount(suiteFake, suiteSensors());
  click(sm.q(".rail-scan"));
  await tick();
  const suiteTick = async (m, sensor, suite) => { const box = m.q('.scan-suite[data-sensor="' + sensor + '"][data-suite="' + suite + '"] .scan-tick'); box.checked = !box.checked; box.dispatchEvent(new Event("change", { bubbles: true })); await tick(); };
  const foldOf = (m, sensor) => ({ open: m.all('.scan-suite[data-sensor="' + sensor + '"]').length > 0, suites: m.all('.scan-suite[data-sensor="' + sensor + '"]').map((r) => ({ name: r.dataset.suite, ticked: r.querySelector(".scan-tick").checked, state: r.querySelector(".scan-state-text").textContent })) });
  const sensorRow = (m, key) => { const r = m.q('.scan-row:not(.scan-suite)[data-sensor="' + key + '"]'); const t = r.querySelector(".scan-tick"); return { ticked: t.checked, indeterminate: t.indeterminate, state: r.querySelector(".scan-state-text").textContent }; };
  facts.suiteStart = { crap: sensorRow(sm, "crap"), fold: foldOf(sm, "crap") };
  click(sm.q('.scan-row[data-sensor="crap"] .scan-fold'));
  await tick();
  facts.suiteOpened = foldOf(sm, "crap");
  facts.suiteFoldWritten = suiteFake.written.at(-1).folds;
  await suiteTick(sm, "crap", "unit");
  facts.suiteAfterTick = { sensor: sensorRow(sm, "crap"), written: suiteFake.written.at(-1) };
  const rapidFake = fakeScan();
  const rapid = await mount(rapidFake, suiteSensors());
  click(rapid.q(".rail-scan"));
  await tick();
  click(rapid.q('.scan-row[data-sensor="crap"] .scan-fold'));
  await tick();
  const rapidBox = (suite) => rapid.q('.scan-suite[data-sensor="crap"][data-suite="' + suite + '"] .scan-tick');
  const rapidBefore = { unit: rapidBox("unit").checked, web: rapidBox("web").checked };
  let releaseFirst = () => {};
  const firstReply = new Promise((resolve) => { releaseFirst = resolve; });
  const requestsBefore = rapidFake.tickRequests.length;
  rapidFake.holdTickReply = (n) => (n === requestsBefore + 1 ? firstReply : null);
  for (const suite of ["unit", "web"]) { const box = rapidBox(suite); box.checked = !box.checked; box.dispatchEvent(new Event("change", { bubbles: true })); }
  await tick();
  const requested = rapidFake.tickRequests.slice(requestsBefore);
  releaseFirst();
  await tick();
  facts.rapidTicks = { before: rapidBefore, requests: requested.map((r) => r.changes.map((c) => c.kind + ":" + c.suite)), after: { unit: rapidBox("unit").checked, web: rapidBox("web").checked } };
  const reopened = await mount(suiteFake, suiteSensors());
  click(reopened.q(".rail-scan"));
  await tick();
  facts.suiteReopened = { sensor: sensorRow(reopened, "crap"), fold: foldOf(reopened, "crap") };
  await reopened.setTick("crap", true);
  await reopened.setTick("crap", true);
  facts.suiteArmed = sensorRow(reopened, "crap");
  click(reopened.q(".scan-run-mode-full"));
  await tick();
  click(reopened.q(".scan-run"));
  await tick(); await tick(); await tick();
  facts.suiteAfterScan = { sensor: sensorRow(reopened, "crap"), fold: foldOf(reopened, "crap"), plan: suiteFake.ran.at(-1) };
  const foldRun = await mount(suiteFake, suiteSensors());
  click(foldRun.q(".rail-scan"));
  await tick();
  if (foldOf(foldRun, "crap").open) { click(foldRun.q('.scan-row[data-sensor="crap"] .scan-fold')); await tick(); }
  click(foldRun.q('.scan-row[data-sensor="crap"] .scan-fold'));
  await tick();
  const foldBefore = { instance: foldRun.wired.explorer, chevron: foldRun.q('.scan-row[data-sensor="crap"] .scan-fold').getAttribute("aria-expanded"), suites: foldOf(foldRun, "crap").suites.length, folds: [...foldRun.wired.rescanner.ticks().folds] };
  click(foldRun.q(".scan-run-mode-full"));
  await tick();
  click(foldRun.q(".scan-run"));
  await tick(); await tick(); await tick();
  facts.foldAcrossRebuild = { before: foldBefore, rebuilt: foldRun.wired.explorer !== foldBefore.instance, chevron: foldRun.q('.scan-row[data-sensor="crap"] .scan-fold').getAttribute("aria-expanded"), suites: foldOf(foldRun, "crap").suites.length, folds: [...foldRun.wired.rescanner.ticks().folds] };
  const memoryRun = await mount(suiteFake, suiteSensors());
  const memoryRows = () => memoryRun.all('.tree .row[data-path^="app/"]').length;
  const memoryBefore = { instance: memoryRun.wired.explorer, rows: memoryRows() };
  click(memoryRun.q('.tree .row[data-path="app"] .name'));
  await tick();
  click(memoryRun.q('.tree .row[data-path="app/a.py"] .reye'));
  await tick();
  click(memoryRun.q('.box[data-id="app/a.py"] .box-body'));
  await tick();
  click(memoryRun.q('.selection-bar [aria-label^="Dependencies"]'));
  await tick();
  memoryBefore.opened = { rows: memoryRows(), inspector: memoryRun.q(".inspector-open") !== null };
  click(memoryRun.q(".rail-scan"));
  await tick();
  click(memoryRun.q(".scan-run-mode-full"));
  await tick();
  click(memoryRun.q(".scan-run"));
  await tick(); await tick(); await tick();
  facts.memoryAcrossFirstScan = { before: memoryBefore, rebuilt: memoryRun.wired.explorer !== memoryBefore.instance, rows: memoryRows(), inspector: memoryRun.q(".inspector-open") !== null };
  click(foldRun.q(".rail-files"));
  await tick();
  click(foldRun.q(".rail-scan"));
  await tick();
  facts.foldReopened = { chevron: foldRun.q('.scan-row[data-sensor="crap"] .scan-fold').getAttribute("aria-expanded"), folds: [...foldRun.wired.rescanner.ticks().folds] };
  click(foldRun.q('.scan-row[data-sensor="crap"] .scan-fold'));
  await tick();
  click(foldRun.q(".scan-run"));
  await tick(); await tick(); await tick();
  facts.foldSecondScan = { chevron: foldRun.q('.scan-row[data-sensor="crap"] .scan-fold').getAttribute("aria-expanded") };
  facts.suiteWidths = {};
  for (const width of [PANEL_LIMITS.tree.min, PANEL_LIMITS.tree.initial]) {
    const explorerEl = reopened.q(".explorer");
    explorerEl.style.setProperty("--tree-w", width + "px");
    await tick();
    for (const key of ["mutation"]) { if (reopened.all('.scan-suite[data-sensor="' + key + '"]').length === 0) { click(reopened.q('.scan-row[data-sensor="' + key + '"] .scan-fold')); await tick(); } }
    const panelEl = reopened.q(".scan-panel");
    const rowsNow = reopened.all(".scan-row");
    const reference = reopened.q('.scan-row[data-sensor="structure"]').getBoundingClientRect().height;
    facts.suiteWidths[width] = {
      count: rowsNow.length,
      heights: rowsNow.map((r) => Math.abs(r.getBoundingClientRect().height - reference) < 1),
      clipped: rowsNow.map((r) => r.scrollWidth > r.clientWidth + 0.5),
      nameClipped: rowsNow.map((r) => { const n = r.querySelector(".scan-row-name"); return n.scrollWidth > n.clientWidth; }),
      panelOverflow: panelEl.scrollWidth > panelEl.clientWidth + 0.5,
      panelWidth: panelEl.getBoundingClientRect().width,
    };
  }

  const unregMount = await mount(fakeScan(), fakeSensors({}, { config: "sensors:\\n  crap: {}\\n" }, {}, INSTALLED));
  click(unregMount.q(".rail-scan"));
  await tick();
  const bareKeys = () => unregMount.all(".scan-row").map((n) => n.dataset.sensor);
  facts.unregistered = { keys: bareKeys(), fixLines: unregMount.q(".scan-panel").textContent.split("recognizer plugin add").length - 1 };
  facts.unregisteredSummary = unregMount.q(".summary").textContent;

  const bareMount = await mount(fakeScan({ steps: [current, summary] }), fakeSensors({}, { config: "sensors: {}\\n" }, {}, INSTALLED), false);
  click(bareMount.q(".rail-scan"));
  await tick();
  bareMount.markScanned();
  bareMount.showRunView();
  click(bareMount.q(".scan-run"));
  await tick(); await tick(); await tick();
  facts.afterRunUnregistered = { shape: bareMount.q(".summary")?.dataset.shape ?? null, card: bareMount.all(".scan-run-card, .scan-card").length, text: bareMount.q(".scan-panel").textContent, button: bareMount.q(".scan-run")?.textContent ?? null, fixLines: bareMount.q(".scan-panel").textContent.split("recognizer plugin add").length - 1 };

  const planGate = gate();
  const pendingFake = fakeScan({ steps: [current, summary] });
  const pending = await mount(pendingFake, undefined, true, {}, FILES, planGate);
  click(pending.q(".rail-scan"));
  await tick();
  facts.beforePlan = pending.panel();
  pending.showRunView();
  await pending.wired.rescanner.run(null);
  await tick(); await tick();
  facts.beforePlanAfterRun = pending.panel();
  planGate.release();
  await tick(); await tick();
  facts.afterPlan = pending.panel();

  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Facts = ReturnType<typeof JSON.parse>;

const _SHORT_AGE = /^(current|now|\d+[mhd])$/;
const GREEN = "rgb(63, 185, 80)";
const ACCENT = "rgb(68, 147, 248)";
const NAMES = [
  "Structural analysis",
  "Descriptions",
  "C.R.A.P.",
  "Mutation",
  "tally",
  "alpha",
  "beta",
];

const _states = (panel: Facts) => panel.rows.map((r: Facts) => r.state);

describe.skipIf(webkit === undefined)("the Scan panel", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = await collectFacts<Facts>(HARNESS, "scan-panel");
  }, scaledTimeout(180000));

  it("summarises one sensor-out-of-date file with no bar and Update 1 file, then everything current with a disabled Up to date once the hashes match", () => {
    expect(f.freshPartial.summary).toMatchObject({
      shape: "behind",
      tone: "warn",
      head: "C.R.A.P. is out of date on 1 file",
      bar: 0,
    });
    expect(f.freshPartial.rowBars).toBe(0);
    expect(f.freshPartial.rows).toEqual([
      { state: "1 file out of date", note: null },
    ]);
    expect(f.freshPartial.button).toBe("Update 1 file");
    expect(f.freshPartial.disabled).toBe(false);
    expect(f.freshPartial.secondary).toBe(0);
    expect(f.freshPartial.mode).toBe("Incremental");
    expect(f.freshPartial.oldSwitch).toBe(0);
    expect(f.freshComplete.summary).toMatchObject({
      shape: "current",
      tone: "ok",
      head: "Everything on the repository is current",
      bar: 0,
    });
    expect(f.freshComplete.rowBars).toBe(0);
    expect(f.freshComplete.button).toBe("Up to date");
    expect(f.freshComplete.disabled).toBe(true);
  });

  it("makes Full the mode toggle: it only relabels the primary, never runs, and swaps back", () => {
    expect(f.freshRescan.button).toBe("Rescan 2 files");
    expect(f.freshRescan.disabled).toBe(false);
    expect(f.freshRescan.secondary).toBe(0);
    expect(f.freshRescan.mode).toBe("Full");
    expect(f.freshRescan.ranBefore).toBe(0);
    expect(f.freshBack.button).toBe("Up to date");
    expect(f.freshBack.secondary).toBe(0);
    expect(f.freshBack.mode).toBe("Incremental");
  });

  it("keeps an open suites fold open when a Scan rebuilds the explorer", () => {
    const r = f.foldAcrossRebuild;
    expect(r.before.chevron).toBe("true");
    expect(r.before.suites).toBeGreaterThan(0);
    expect(r.before.folds).toEqual(["crap"]);
    expect(r.rebuilt).toBe(true);
    expect(r.chevron).toBe("true");
    expect(r.suites).toBe(r.before.suites);
    expect(r.folds).toEqual(["crap"]);
  });

  it("keeps the expanded folders and the open inspector across the first Scan", () => {
    const r = f.memoryAcrossFirstScan;
    expect(r.before.opened.rows).toBeGreaterThan(r.before.rows);
    expect(r.before.opened.inspector).toBe(true);
    expect(r.rebuilt).toBe(true);
    expect(r.rows).toBe(r.before.opened.rows);
    expect(r.inspector).toBe(true);
  });

  it("matches the mock while running: Scanning…, every planned row running, the one summary bar and a row bar, a disabled Running button and a Stop beside it", () => {
    expect(f.run.first).not.toBeNull();
    expect(f.run.heldSamples).toBe(0);
    expect(f.run.heldPlans).toBe(0);
    expect(f.run.plans).toEqual([
      {
        describe: true,
        describeAll: false,
        analysis: true,
        sense: ["tally", "crap"],
        modules: ["app/a.py", "app/b.py"],
        plannedMs: {},
      },
    ]);
    expect(f.run.first.header).toBe(
      "Running Descriptions, tally and C.R.A.P.\u2026 Describing\u2026 0 of 1 files",
    );
    expect(
      f.run.first.rows
        .filter((r: Facts) => r.spinner > 0)
        .map((r: Facts) => r.key),
    ).toEqual(["describe", "crap", "tally"]);
    expect([1, 2, 4].map((i) => f.run.first.rows[i].state)).toEqual([
      "0 of 1",
      "running",
      "running",
    ]);
    expect(f.run.first.rows[1].color).toBe(ACCENT);
    expect(f.run.first.summary).toMatchObject({
      shape: "running",
      tone: "run",
      head: "Running Descriptions, C.R.A.P. and tally on 2 files",
      bar: 1,
      spinning: true,
    });
    expect(f.run.first.rowBars).toBe(1);
    expect(f.run.first.buttons).toEqual([
      { text: "Running", disabled: true, spinner: 1 },
      { text: "Stop", disabled: false, spinner: 0 },
    ]);
    expect(f.run.footer.text).toBe(
      "Running Descriptions, tally and C.R.A.P.\u2026 Describing\u2026 0 of 1 files",
    );
    expect(f.run.footer.buttons).toEqual(["bell"]);
    expect(f.run.footerAfter.text).toBe("");
    expect(f.run.footerAfter.buttons).toEqual(["bell"]);
    expect(f.run.first.rows.every((r: Facts) => r.disabled)).toBe(true);
  });

  it("moves each row on as it finishes and draws no bar once the run is over", () => {
    const row = (panel: Facts, key: string) =>
      panel.rows.find((r: Facts) => r.key === key);

    expect(row(f.run.afterDescribe, "tally").state).toBe("running");
    expect(row(f.run.afterDescribe, "crap").state).toBe("running");
    expect(row(f.run.afterDuplication, "tally").state).toBe("now");
    expect(row(f.run.afterDuplication, "tally").color).toBe(GREEN);
    expect(row(f.run.afterDuplication, "crap").state).toBe("running");
    expect(row(f.run.after, "tally").state).toBe("now");
    expect(f.run.after.header).toBe("Ran just now");
    expect(f.run.after.rowBars).toBe(0);
    expect(f.run.after.summary.bar).toBe(0);
    expect(f.run.after.summary.shape).not.toBe("running");
  });

  it("refuses a second scan while one runs", () => {
    expect(f.run.second).toEqual({
      status: "refused",
      reason: "a scan is already running",
    });
    expect(f.run.plans).toHaveLength(1);
  });

  it("posts exactly one tray message for a failed sensor", () => {
    expect(f.failed.posted).toEqual(["tally failed: broke"]);
    expect(f.sensorFail.reasonLines).toBe(0);
  });

  it("shows a failed sensor row from the message's Show and opens the log from its Open log", () => {
    expect(f.sensorFail.footer.text).toBe("");
    expect(f.sensorFail.footer.buttons).toEqual(["bell"]);
    expect(f.sensorFail.messages).toEqual([
      {
        text: "tally failed: broke",
        actions: ["Show", "Open log"],
      },
    ]);
    expect(f.sensorFail.hiddenBefore).toBe(true);
    expect(f.sensorFail.panelOpen).toBe(true);
    expect(f.sensorFail.dot).toBe(true);
    expect(f.sensorFail.opened).toEqual([".recognizer/cache/log/x-scan.json"]);
  });

  it("offers Show without Open log when the run left no log", () => {
    expect(f.noLog).toEqual([
      { text: "tally failed: broke", actions: ["Show"] },
    ]);
  });

  it("shows a failed file from the message's Show on the inspector with the reason under its header", () => {
    expect(f.moduleFail.footer.buttons).toEqual(["bell"]);
    expect(f.moduleFail.messages).toEqual([
      {
        text: "Describe wrote 0 lines, 2 files failed.",
        actions: ["Show", "Open log"],
      },
    ]);
    expect(f.moduleFail.header).toContain("a.py");
    expect(f.moduleFail.reason).toBe("no describer");
  });

  it("shows no text and no Describe button when a file has no line", () => {
    expect(f.missing.text).toBe("");
    expect(f.missing.describe).toBe(0);
  });

  it("lists a report after the list with no checkbox, its age and short commit, and a Clear button that deletes it", () => {
    expect(f.report.names).toEqual(NAMES);
    expect(f.report.listCount).toBe(7);
    expect(f.report.ticks).toBe(0);
    expect(f.report.chip).toBe("reported 3 minutes ago");
    expect(f.report.commit).toBe("feed123");
    expect(f.report.clear).toBe("Clear");
    expect(f.report.afterList).toBe(true);
    expect(f.reportCleared.removed).toEqual(["review"]);
    expect(f.reportCleared.present).toBe(false);
  });
});
