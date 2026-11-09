import { beforeAll, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../scripts/pool-scale.mjs";
import { collectFacts, FAKE_WORKER, here, webkit } from "./look-page";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { loadedOf, registeredOf, scanHostOf, mountExplorer } from ${JSON.stringify(here("look-support.ts"))};
import { fakeViews } from ${JSON.stringify(here("views-fake.ts"))};
import { fakeSensors } from ${JSON.stringify(here("sensors-fake.ts"))};
import { fakeEditor } from ${JSON.stringify(here("editor-fake.ts"))};
import { fakeResponsibilities } from ${JSON.stringify(here("responsibilities-fake.ts"))};
import { fakeScan } from ${JSON.stringify(here("scan-fake.ts"))};
import REASONS from ${JSON.stringify(here("../../fixtures/sensor-reasons/states.json"))};
import { buildFooter } from ${JSON.stringify(here("footer-view.ts"))};
import { createRescanner } from ${JSON.stringify(here("rescanner.ts"))};
import { withSensors } from ${JSON.stringify(here("sensor-run.ts"))};
import { NO_CHANGES } from ${JSON.stringify(here("footer-scan.ts"))};
import { rowSensors } from ${JSON.stringify(here("scan-panel-model.ts"))};
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
const SHIPPED = [
  { name: "mutation", display: "Mutation", line: "Mutates and tests.", defaults: {}, runsTests: true, listed: true },
  { name: "crap", display: "C.R.A.P.", line: "Runs the tests with coverage.", defaults: {}, runsTests: true, listed: true },
  { name: "duplication", display: "Duplication", line: "Finds repeated structure.", defaults: {}, runsTests: false, listed: true },
  { name: "thresholds", display: "Thresholds", line: "Limits.", defaults: {}, runsTests: false, listed: false },
];
const CONFIG = "sensors:\\n  alpha:\\n    command: [node, '{repository}/a.mjs', '{commit}', '{output}']\\n  beta:\\n    command: [node, '{repository}/b.mjs', '{commit}', '{output}']\\n";
const FILES = { responsibilities: null, config: CONFIG, refused: [], hashes: {} };
const ORIGIN = { branch: "main", commit: "cur1234" };
const json = (value) => JSON.stringify(value);
const current = json({ event: "phase", phase: "extract", state: "current", commit: "cur1234" });
const describing = (total) => json({ event: "phase", phase: "describe", total });
const sensing = (total) => json({ event: "phase", phase: "sense", total });
const entry = (phase, name, reason) => json({ event: "entry", phase, name, outcome: reason === undefined ? "ok" : "failed", ...(reason === undefined ? {} : { reason }) });
const summary = json({ event: "summary" });
const gate = () => { let release = () => {}; const promise = new Promise((resolve) => { release = resolve; }); return { promise, release }; };

const tick = () => new Promise((resolve) => setTimeout(resolve, 60));
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

async function mount(fake, sensors = fakeSensors({}, { config: CONFIG }, {}, SHIPPED), scanned = true, viewFiles = {}, files = FILES) {
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
  const wired = { tray: [], posted: [], explorer: null, current: null, scanState: null, scanning: null, rescanner: null };
  const withProgress = (state) => ({ ...state, scanning: wired.scanning });
  const footer = buildFooter(footerEl);
  const scanHost = scanHostOf({
    port: sensors,
    scan: () => wired.scanState,
    ticks: () => wired.rescanner.ticks(),
    setTicks: (next) => wired.rescanner.setTicks(next),
    runState: () => wired.rescanner.runState(),
    running: () => wired.rescanner.running(),
    run: (modules, planned) => void wired.rescanner.run(modules, planned),
    stop: () => void wired.rescanner.stop(),
    refresh: () => void wired.rescanner.refresh(),
    footer: (text) => footer.setScan(text),
    progressText: () => wired.scanning,
    describeProgress: () => { const d = wired.rescanner.progress().describe; return d === null ? null : { entries: d.entries.length, total: d.total }; },
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
    registered: async () => { const { config } = await sensors.readInputs(); return registeredOf(rowSensors(config, await sensors.shipped())); },
    load: () => base,
    sense: (loaded) => withSensors(loaded, sensors),
    resense: async () => withSensors(wired.current, sensors),
    adopt: async () => ORIGIN,
    carry: () => wired.explorer?.carry() ?? null,
    replace: (loaded, carried) => { wired.explorer?.dispose(); wired.explorer = build(loaded, carried); },
    update: (loaded) => { if (wired.explorer === null) return false; wired.current = loaded; wired.explorer.update(loaded); return true; },
    adopted: (origin) => setScan(withProgress({ origin, scannedAt: Date.now(), changes: NO_CHANGES })),
    describedLine: () => wired.explorer?.refreshResponsibilities(),
    progress: (update) => { wired.scanning = update.scanning; if (wired.scanState !== null) setScan(withProgress(wired.scanState)); wired.explorer?.refreshPanel(); },
    settled: () => {},
    blocked: (text) => { footer.post({ kind: "error", text: "Rescan failed: " + text }); },
    post: (input) => { wired.tray.push(input); return footer.post(input); },
    attach: (id, extra) => footer.attach(id, extra),
    openLog: (log) => { void editor.openFile(log); },
    show: (target) => wired.explorer.show(target),
  });
  await wired.rescanner.loadTicks();
  wired.current = base;
  if (scanned) setScan(withProgress({ origin: ORIGIN, scannedAt: Date.now(), changes: NO_CHANGES }));
  wired.explorer = build(await withSensors(base, sensors), null);
  await tick();

  const q = (selector) => root.querySelector(selector);
  const all = (selector) => [...root.querySelectorAll(selector)];
  const visible = (selector) => { const n = q(selector); return n !== null && getComputedStyle(n).display !== "none"; };
  const rows = () => all(".scan-row").map((r) => ({ key: r.dataset.sensor, name: r.querySelector(".scan-row-label").textContent, state: r.querySelector(".scan-state-text").textContent, note: r.querySelector(".scan-note")?.textContent ?? null, tone: r.querySelector(".scan-state").className.replace("scan-state", "").trim(), color: getComputedStyle(r.querySelector(".scan-state")).color, title: r.dataset.tip, ticked: r.querySelector(".scan-tick").checked, disabled: r.querySelector(".scan-tick").disabled, accent: getComputedStyle(r.querySelector(".scan-tick")).accentColor, spinner: r.querySelectorAll(".scan-state .scan-spin").length, logLink: r.querySelector(".scan-log-link")?.textContent ?? null, bar: r.querySelectorAll(".scan-bar").length }));
  const text = (selector) => q(selector)?.textContent ?? "<missing " + selector + ">";
  const scanLineText = () => q(".scan-line").textContent;
  const footerButtons = () => all(".footer button").filter((b) => !b.closest(".message-tray, .message-toast")).map((b) => b.className);
  const messages = () => all(".message-list .msg").map((m) => ({ text: m.querySelector(".msg-text").textContent, actions: [...m.querySelectorAll(".msg-act")].map((b) => b.textContent) }));
  const message = (contains) => all(".message-list .msg").find((m) => m.querySelector(".msg-text").textContent.includes(contains));
  const act = (contains, label) => click([...message(contains).querySelectorAll(".msg-act")].find((b) => b.textContent === label));
  const setTick = async (key, checked) => { const box = q('.scan-row[data-sensor="' + key + '"] .scan-tick'); box.checked = checked; box.dispatchEvent(new Event("change", { bubbles: true })); await tick(); };
  const panel = () => ({ header: q(".scan-sub").textContent, amber: q(".scan-sub .warn")?.textContent ?? null, amberColor: q(".scan-sub .warn") ? getComputedStyle(q(".scan-sub .warn")).color : null, rows: rows(), buttons: all(".scan-buttons button").map((b) => ({ text: b.textContent, disabled: b.disabled, spinner: b.querySelectorAll("svg").length })), summary: q(".summary") ? { shape: q(".summary").dataset.shape, tone: q(".summary").className.replace("summary", "").trim(), head: q(".summary-head").textContent, line: q(".summary-line").textContent, bar: all(".summary-bar").length, spinning: q(".summary .scan-spin") !== null } : null, rowBars: all(".scan-bar").length, strays: all(".scan-block, .scan-block-title, .sensor-add, .sensor-remove, .scan-summary, .scan-stop-button, .scan-panel h2, .scan-panel h3, .scan-extract, .scan-describe, .measure-row").length, subLines: all(".scan-row *").filter((n) => n.matches("div")).length });

  return { host, q, all, visible, rows, text, scanLineText, footerButtons, messages, act, setTick, panel, fake, editor, wired, sensors };
}

(async () => {
  const facts = {};

  const fake = fakeScan();
  const a = await mount(fake, undefined, false);
  click(a.q(".rail-scan"));
  await tick();
  facts.fresh = { ...a.panel(), order: a.all(".rail button").map((b) => b.className.split(" ")[1]), railLabel: getComputedStyle(a.q(".rail-scan"), "::after").content, files: a.visible(".tree-header"), panelOpen: a.visible(".scan-panel"), ran: fake.ran.length, buttonTitle: a.q(".scan-run").title };

  const rowEls = a.all(".scan-row");
  const first = rowEls[0].querySelector(".scan-state");
  first.textContent = "155 modules described, 34 minutes ago";
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
  await b.setTick("duplication", true);
  await b.setTick("crap", true);
  facts.ticked = { rows: b.rows().filter((r) => r.ticked).map((r) => r.key), written: fake.written.at(-1) };

  const c = await mount(fake);
  click(c.q(".rail-scan"));
  await tick();
  facts.reopened = c.rows().filter((r) => r.ticked).map((r) => r.key);

  const g1 = gate(); const g2 = gate(); const g3 = gate();
  const startLine = (name) => json({ event: "start", phase: "sense", name });
  fake.steps = [current, describing(1), entry("describe", "app/a.py"), g1.promise, sensing(2), startLine("duplication"), g2.promise, entry("sense", "duplication"), startLine("crap"), g3.promise, entry("sense", "crap"), summary];
  const during = [];
  const duringFooter = [];
  fake.onStep = (index) => { if ([1, 3, 5, 8].includes(index)) { during.push(c.panel()); duringFooter.push({ text: c.scanLineText(), buttons: c.footerButtons() }); } if (index === 6) c.sensors.files.set("duplication", json({ findings_version: 1, sensor: { name: "duplication", version: "1" }, commit: "cur1234", modified: false, settings: {}, inputs: { "app/a.py": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "app/b.py": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }, findings: [] })); };
  await c.setTick("describe", true);
  await c.setTick("crap", true);
  click(c.q(".scan-run"));
  await tick();
  facts.run = { plans: fake.ran, first: during[0] ?? null, footer: duringFooter[0] ?? null };
  facts.run.second = await fake.run({ describe: false, sense: [] });
  g1.release(); await tick();
  facts.run.afterDescribe = c.panel();
  g2.release(); await tick();
  facts.run.afterDuplication = c.panel();
  g3.release(); await tick(); await tick();
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
  const tickedBefore = s.rows().map((r) => r.ticked);
  s.all(".scan-row-label").forEach((label) => click(label));
  await tick();
  facts.ticksWhileRunning = { disabled: s.rows().map((r) => r.disabled), unchanged: s.rows().map((r) => r.ticked).join() === tickedBefore.join(), stopEnabled: s.q(".scan-stop").disabled === false };
  click(s.q(".scan-stop"));
  await tick(); await tick();
  facts.ticksAfterStop = s.rows().map((r) => r.disabled);
  facts.stop = { footer: s.scanLineText(), footerButtons: s.footerButtons(), stopAfter: s.all(".scan-stop").length, button: s.q(".scan-run")?.textContent ?? "", disabled: s.q(".scan-run")?.disabled };

  const changed = await mount(fakeScan());
  changed.wired.scanState = { ...changed.wired.scanState, scannedAt: Date.now() - 2 * 3600000, changes: { files: [{ path: "app/a.py", kind: "modified" }], moved: null } };
  click(changed.q(".rail-scan"));
  await tick();
  changed.wired.explorer.refreshPanel();
  facts.changed = changed.panel();

  const failFake = fakeScan({
    defaults: { describe: false, sensors: true },
    steps: [current, sensing(1), entry("sense", "duplication", "broke"), summary],
    result: { status: "finished", exitCode: 1, stderr: "", log: ".recognizer/cache/log/x-scan.json" },
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
  t.act("duplication failed", "Show");
  await tick();
  const dot = t.q(".rail-scan .rail-dot");
  t.act("duplication failed", "Open log");
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
    steps: [current, sensing(1), entry("sense", "duplication", "broke"), summary],
    result: { status: "finished", exitCode: 1, stderr: "", log: null },
  });
  const bare = await mount(bareFake);
  click(bare.q(".rail-scan"));
  await tick();
  click(bare.q(".scan-run"));
  await tick(); await tick();
  facts.noLog = bare.messages();

  const moduleFake = fakeScan({
    defaults: { describe: true, sensors: false },
    steps: [current, describing(2), entry("describe", "app/a.py", "no describer"), entry("describe", "app/b.py", "no describer"), summary],
    result: { status: "finished", exitCode: 1, stderr: "", log: ".recognizer/cache/log/y-scan.json" },
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
  const slowSensors = fakeSensors({}, { config: CONFIG }, {}, SHIPPED);
  const instantShipped = slowSensors.shipped.bind(slowSensors);
  slowSensors.shipped = async () => { await pendingGate.promise; return instantShipped(); };
  const slow = await mount(fakeScan(), slowSensors);
  click(slow.q(".rail-scan"));
  await tick();
  facts.pending = { header: slow.q(".scan-sub").textContent, rows: slow.rows().length, buttons: slow.all(".scan-buttons button").length, list: slow.q(".scan-list").children.length };
  pendingGate.release();
  await tick();
  facts.loaded = { rows: slow.rows().map((r) => r.name), buttons: slow.all(".scan-buttons button").length };

  const REPORT = json({ findings_version: 1, sensor: { name: "review", version: "reported" }, commit: "feed123abc", modified: false, settings: {}, reported_at: new Date(Date.now() - 3 * 60000).toISOString(), findings: [] });
  const reportSensors = fakeSensors({ review: REPORT }, { config: CONFIG }, {}, SHIPPED);
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
  facts.scopeOff = { scope: scopeOf(), describe: stateOf("describe"), mutation: stateOf("mutation"), mutationNote: noteOf("mutation"), crap: stateOf("crap"), duplication: stateOf("duplication") };
  click(sc.q(".scan-scope-canvas"));
  await tick();
  facts.scopeOn = { scope: scopeOf(), describe: stateOf("describe"), mutation: stateOf("mutation"), mutationNote: noteOf("mutation"), crap: stateOf("crap"), duplication: stateOf("duplication"), written: scopeFake.written.at(-1) };
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

  const crapDoc = (hashes) => json({ findings_version: 1, sensor: { name: "crap", version: "1" }, commit: "cur1234", modified: false, settings: {}, inputs: hashes, findings: [] });
  const fsensors = fakeSensors({}, { config: CONFIG }, {}, SHIPPED);
  fsensors.files.set("crap", crapDoc({ "app/a.py": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "app/b.py": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" }));
  for (const name of ["duplication", "mutation", "alpha", "beta"]) fsensors.files.set(name, json({ findings_version: 1, sensor: { name, version: "1" }, commit: "cur1234", modified: false, settings: {}, inputs: { "app/a.py": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "app/b.py": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }, findings: [] }));
  const HA = "a".repeat(64);
  const HB = "b".repeat(64);
  const line = (hash) => ({ line: "Does a thing.", source_hash: hash, describer: ["node", "d.js"], version: "v1" });
  const described = { responsibilities: json({ schema_version: 1, modules: { "app/a.py": line(HA), "app/b.py": line(HB) } }), config: CONFIG + "describer:\\n  command: [node, d.js]\\n  version: v1\\n", refused: [], hashes: { "app/a.py": HA, "app/b.py": HB } };
  const fr = await mount(fakeScan(), fsensors, true, {}, described);
  click(fr.q(".rail-scan"));
  await tick();
  await fr.setTick("crap", true);
  const freshFacts = () => ({ summary: fr.panel().summary, rows: fr.rows().filter((r) => r.key === "crap").map((r) => ({ state: r.state, note: r.note })), rowBars: fr.all(".scan-bar, .summary-bar").length, button: fr.q(".scan-run")?.textContent ?? null, disabled: fr.q(".scan-run")?.disabled ?? null, secondary: fr.q(".scan-secondary")?.textContent ?? null, oldSwitch: fr.all(".scan-mode, .scan-mode-switch").length });
  facts.freshPartial = freshFacts();
  fsensors.files.set("crap", crapDoc({ "app/a.py": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "app/b.py": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }));
  await fr.wired.rescanner.refresh();
  await tick(); await tick();
  facts.freshComplete = freshFacts();
  click(fr.q(".scan-secondary"));
  await tick();
  facts.freshRescan = { ...freshFacts(), ranBefore: fr.fake.ran.length };
  click(fr.q(".scan-secondary"));
  await tick();
  facts.freshBack = freshFacts();

  const ranDoc = (name, diagnosis) => json({ findings_version: 1, sensor: { name, version: "1" }, commit: "cur1234", modified: false, settings: {}, inputs: { "app/a.py": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "app/b.py": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }, findings: [], diagnosis });
  const whyFacts = (m, key) => {
    const row = m.q('.scan-row[data-sensor="' + key + '"]');
    const why = row.querySelector(".scan-why");
    const rowBox = row.getBoundingClientRect();
    const whyBox = why ? why.getBoundingClientRect() : null;
    const next = row.nextElementSibling;
    const nextBox = next ? next.getBoundingClientRect() : null;
    return {
      state: m.rows().find((r) => r.key === key).state,
      tone: m.rows().find((r) => r.key === key).tone,
      why: why ? [...why.childNodes].filter((n) => n.nodeType === 3 || n.tagName === "CODE").map((n) => n.textContent).join("").trim() : null,
      chips: why ? [...why.querySelectorAll("code")].map((c) => c.textContent) : [],
      copy: why?.querySelector(".scan-why-copy")?.textContent ?? null,
      log: why?.querySelector(".scan-why-log")?.textContent ?? null,
      inside: whyBox === null ? null : whyBox.top >= rowBox.top - 0.5 && whyBox.bottom <= rowBox.bottom + 0.5 && whyBox.left >= rowBox.left - 0.5 && whyBox.right <= rowBox.right + 0.5,
      clear: whyBox === null || nextBox === null ? null : nextBox.top >= whyBox.bottom - 0.5,
    };
  };
  const openScan = async (m) => { click(m.q(".rail-scan")); await tick(); };
  const reasonScan = async (name, diagnosis) => {
    const lines = [current, sensing(1), json({ event: "start", phase: "sense", name }), json({ event: "entry", phase: "sense", name, outcome: "failed", reason: diagnosis.line, diagnosis }), summary];
    const m = await mount(fakeScan({ steps: lines }));
    await openScan(m);
    await m.setTick(name, true);
    click(m.q(".scan-run"));
    await tick(); await tick(); await tick();
    return m;
  };
  const completedScan = async (name, diagnosis) => {
    const m = await mount(fakeScan(), fakeSensors({ [name]: ranDoc(name, diagnosis) }, { config: CONFIG }, {}, SHIPPED));
    await openScan(m);
    return m;
  };
  facts.reasons = {};
  const crapRed = await completedScan("crap", REASONS["crap-tests-failed"]);
  facts.reasons.crapRed = whyFacts(crapRed, "crap");
  click(crapRed.q('.scan-row[data-sensor="crap"] .scan-why-log'));
  await tick();
  facts.reasons.opened = crapRed.editor.opened.map((o) => o.file);
  const crapNoCov = await completedScan("crap", REASONS["crap-no-coverage"]);
  facts.reasons.crapNoCov = whyFacts(crapNoCov, "crap");
  click(crapNoCov.q('.scan-row[data-sensor="crap"] .scan-why-copy'));
  await tick();
  facts.reasons.copied = crapNoCov.wired.views.copied;
  facts.reasons.crapNoRun = whyFacts(await reasonScan("crap", REASONS["crap-no-runner"]), "crap");
  facts.reasons.mutationRed = whyFacts(await reasonScan("mutation", REASONS["mutation-tests-failing"]), "mutation");
  facts.reasons.mutationNoCov = whyFacts(await reasonScan("mutation", REASONS["mutation-no-coverage"]), "mutation");
  facts.reasons.plain = (await (async () => { const m = await mount(fakeScan({ steps: [current, sensing(1), json({ event: "entry", phase: "sense", name: "crap", outcome: "failed", reason: "boom" }), summary] })); await openScan(m); await m.setTick("crap", true); click(m.q(".scan-run")); await tick(); await tick(); await tick(); return whyFacts(m, "crap"); })());

  const recordOf = (name, outcome, at, diagnosis) => json({ log_version: 1, kind: "scan", started: at, finished: at, by: "ken", arguments: [], outcome, exit: outcome === "ok" ? 0 : 1, phases: [{ phase: "sense", entries: [{ name, command: ["x"], status: outcome === "ok" ? 0 : 1, outcome, duration_ms: 1, stderr: "", ...(outcome === "failed" ? { reason: "tests failed", ...(diagnosis ? { diagnosis } : {}) } : {}) }] }] });
  const restart = async (records, modifiedMs) => {
    const f = fakeSensors({ crap: ranDoc("crap", undefined) }, { config: CONFIG + "  crap:\\n    command: [recognizer-sensors, crap, '{repository}']\\n" }, {}, SHIPPED);
    if (modifiedMs !== undefined) f.modified.set("crap", modifiedMs);
    for (const [name, text] of Object.entries(records)) f.runRecords.set(name, text);
    const m = await mount(fakeScan(), f);
    await openScan(m);
    return whyFacts(m, "crap");
  };
  const FAILED_AT = "2026-11-02T09:00:00.000Z";
  const FAILED = recordOf("crap", "failed", FAILED_AT, REASONS["mutation-tests-failing"]);
  facts.restart = {
    refused: await restart({ "20261102T090000000Z-scan.json": FAILED }, Date.parse(FAILED_AT) - 1000),
    okNewer: await restart({ "20261102T090000000Z-scan.json": FAILED, "20261102T100000000Z-scan.json": recordOf("crap", "ok", "2026-11-02T10:00:00.000Z") }, Date.parse(FAILED_AT) - 1000),
    copy: await restart({ "20261102T090000000Z-scan.json": recordOf("crap", "failed", FAILED_AT, REASONS["crap-no-coverage"]) }, Date.parse(FAILED_AT) - 1000),
    none: await restart({}, Date.parse(FAILED_AT) - 1000),
    older: await restart({ "20261102T090000000Z-scan.json": FAILED }, Date.parse(FAILED_AT) + 1000),
    tie: await restart({ "20261102T090000000Z-scan.json": FAILED }, Date.parse(FAILED_AT)),
  };

  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Facts = ReturnType<typeof JSON.parse>;

const GREEN = "rgb(63, 185, 80)";
const RED = "rgb(248, 81, 73)";
const ACCENT = "rgb(68, 147, 248)";
const MUTED = "rgb(145, 152, 161)";
const NAMES = [
  "Structure",
  "Descriptions",
  "C.R.A.P.",
  "Duplication",
  "Mutation",
  "alpha",
  "beta",
];

const names = (panel: Facts) => panel.rows.map((r: Facts) => r.name);
const states = (panel: Facts) => panel.rows.map((r: Facts) => r.state);

describe.skipIf(webkit === undefined)("the Scan panel", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = await collectFacts<Facts>(HARNESS, "scan-panel");
  }, scaledTimeout(180000));

  it("offers the canvas and whole-repository switch on an Untitled canvas, captioned This canvas and sized by its open modules", () => {
    expect(f.scopeNone.scope.switches).toBe(1);
    expect(f.scopeNone.scope.caption).toBe("This canvas, 0");
    expect(f.scopeNone.scope.all).toBe("Whole repository");
    expect(f.scopeUntitled.scope.caption).toMatch(/^This canvas, [1-9]/);
    expect(f.scopeUntitledOn.scope.on).toBe("true");
  });

  it("captions a saved view by name and locks the switch during a run", () => {
    expect(f.scopeOff.scope).toEqual({
      switches: 1,
      caption: "demo, 1",
      on: "false",
      all: "Whole repository",
      disabled: false,
    });
    expect(f.scopeOn.scope.on).toBe("true");
    expect(f.scopeRunning.disabled).toBe(true);
    expect(f.scopeRan.after.disabled).toBe(false);
  });

  it("reads Descriptions and a ticked Mutation row as never run under either scope and leaves the other rows alone", () => {
    expect(f.scopeOff.describe).toBe("never run");
    expect(f.scopeOff.mutation).toBe("never run");
    expect(f.scopeOn.describe).toBe("never run");
    expect(f.scopeOn.mutation).toBe("never run");
    expect(f.scopeOn.crap).toBe(f.scopeOff.crap);
    expect(f.scopeOn.duplication).toBe(f.scopeOff.duplication);
  });

  it("remembers the switch through the port and sends the view's module ids when it is on, and a click on the Update button runs the unticked rows once the scope is off", () => {
    expect(f.scopeOn.written.onlyView).toBe(true);
    expect(f.scopeRan.modules).toEqual([["app/a.py"]]);
    expect(f.scopeOffRan).toEqual([["app/a.py"]]);
  });

  it("summarises one changed module with no bar and Update 1 module, then everything current with a disabled Up to date once the hashes match", () => {
    expect(f.freshPartial.summary).toMatchObject({
      shape: "changed",
      tone: "warn",
      head: "1 module changed since it was scanned",
      bar: 0,
    });
    expect(f.freshPartial.rowBars).toBe(0);
    expect(f.freshPartial.rows).toEqual([
      { state: "1 module out of date", note: null },
    ]);
    expect(f.freshPartial.button).toBe("Update 1 module");
    expect(f.freshPartial.disabled).toBe(false);
    expect(f.freshPartial.secondary).toBe("Rescan from scratch");
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

  it("makes Rescan from scratch the secondary action: it only relabels the primary, never runs, and swaps back", () => {
    expect(f.freshRescan.button).toBe("Rescan 2 modules");
    expect(f.freshRescan.disabled).toBe(false);
    expect(f.freshRescan.secondary).toBe("Update only what changed");
    expect(f.freshRescan.ranBefore).toBe(0);
    expect(f.freshBack.button).toBe("Up to date");
    expect(f.freshBack.secondary).toBe("Rescan from scratch");
  });

  it("sits third on the rail as Scan, swaps with the tree and runs nothing on open", () => {
    expect(f.fresh.order).toEqual([
      "rail-files",
      "rail-views",
      "rail-notes",
      "rail-scan",
      "rail-findings",
    ]);
    expect(f.fresh.panelOpen).toBe(true);
    expect(f.fresh.files).toBe(false);
    expect(f.fresh.ran).toBe(0);
    expect(f.fresh.railLabel).toContain("Scan");
  });

  it("matches the mock's fresh repository: Not scanned yet, one list, only Structure ticked, every row never run", () => {
    expect(f.fresh.header).toBe("Not scanned yet");
    expect(names(f.fresh)).toEqual(NAMES);
    expect(states(f.fresh)).toEqual(Array(7).fill("never run"));
    expect(
      f.fresh.rows.filter((r: Facts) => r.ticked).map((r: Facts) => r.key),
    ).toEqual(["structure"]);
    expect(f.fresh.rows.every((r: Facts) => r.color === MUTED)).toBe(true);
    expect(f.fresh.summary).toMatchObject({
      shape: "attention",
      tone: "warn",
      head: "Structure, Descriptions, C.R.A.P., Duplication, Mutation, alpha and beta have never run",
      bar: 0,
    });
    expect(f.fresh.rowBars).toBe(0);
  });

  it("has no heading, sub-line, Remove button, Add block, summary or disabled checkbox, and an accent-coloured checkbox", () => {
    expect(f.fresh.strays).toBe(0);
    expect(f.fresh.subLines).toBe(0);
    expect(
      f.fresh.rows.filter((r: Facts) => r.disabled).map((r: Facts) => r.key),
    ).toEqual(["structure"]);
    expect(f.fresh.rows.every((r: Facts) => r.accent === ACCENT)).toBe(true);
  });

  it("titles each row with its one-sentence description and prints nothing under it", () => {
    const title = (key: string) =>
      f.fresh.rows.find((r: Facts) => r.key === key).title;

    expect(title("structure")).toBe("Structure always runs");
    expect(title("describe")).toBe(
      "Writes one line per module saying what it is responsible for.",
    );
    expect(title("crap")).toBe(
      "C.R.A.P.: Change Risk Anti-Patterns. Runs the tests with coverage.",
    );
    expect(title("duplication")).toBe("Finds repeated structure.");
  });

  it("wraps a long status inside the panel's content box and keeps the tip inside the window", () => {
    expect(f.long.stateRight).toBeLessThanOrEqual(f.long.contentRight + 0.5);
    expect(f.long.lines).toBeGreaterThanOrEqual(2);
    expect(f.long.nameOverflow).toBe(false);
    expect(f.long.tip.left).toBeGreaterThanOrEqual(0);
    expect(f.long.tip.top).toBeGreaterThanOrEqual(0);
    expect(f.long.tip.right).toBeLessThanOrEqual(f.long.viewport.w);
    expect(f.long.tip.bottom).toBeLessThanOrEqual(f.long.viewport.h);
  });

  it("has the primary button naming its work with the secondary text button beside it", () => {
    expect(f.fresh.buttons).toEqual([
      { text: "Run Structure", disabled: false, spinner: 0 },
      { text: "Rescan from scratch", disabled: false, spinner: 0 },
    ]);
    expect(f.fresh.buttonTitle).toBe("");
  });

  it("matches the mock after a scan: Scanned with an age and no sha or counts", () => {
    expect(f.scanned.header).toBe("Ran just now");
    expect(f.scanned.amber).toBeNull();
  });

  it("carries no amber phrase in the header with files changed, and says so in the summary and the Structure row", () => {
    expect(f.changed.header).toBe("Ran 2 hours ago");
    expect(f.changed.amber).toBeNull();
    expect(f.changed.summary).toMatchObject({
      shape: "attention",
      head: "Descriptions, C.R.A.P., Duplication, Mutation, alpha and beta have never run",
      bar: 0,
    });
    expect(f.changed.rows.find((r: Facts) => r.key === "structure").state).toBe(
      "1 module out of date",
    );
    expect(f.changed.buttons[0]).toEqual({
      text: "Update 1 module",
      disabled: false,
      spinner: 0,
    });
  });

  it("remembers a tick through the port, never a tests-running sensor, and a reopened window reads it back", () => {
    expect(f.ticked.rows).toEqual([
      "structure",
      "describe",
      "crap",
      "duplication",
    ]);
    expect(f.ticked.written).toEqual({
      describe: true,
      ticked: ["duplication"],
      onlyView: false,
    });
    expect(f.reopened).toEqual(["structure", "describe", "duplication"]);
  });

  it("matches the mock while running: Scanning…, every planned row running, the one summary bar and a row bar, a disabled Running button and a Stop beside it", () => {
    expect(f.run.plans).toEqual([
      {
        describe: true,
        describeAll: false,
        sense: ["duplication", "crap"],
        modules: ["app/a.py", "app/b.py"],
      },
    ]);
    expect(f.run.first.header).toBe(
      "Running Descriptions, Duplication and C.R.A.P.\u2026 Describing\u2026 0 of 1 modules",
    );
    expect(
      f.run.first.rows
        .filter((r: Facts) => r.spinner > 0)
        .map((r: Facts) => r.key),
    ).toEqual(["describe", "crap", "duplication"]);
    expect(f.run.first.rows.map((r: Facts) => r.state).slice(1, 4)).toEqual([
      "0 of 1",
      "running",
      "running",
    ]);
    expect(f.run.first.rows[1].color).toBe(ACCENT);
    expect(f.run.first.summary).toMatchObject({
      shape: "running",
      tone: "run",
      head: "Running Descriptions, C.R.A.P. and Duplication on 2 modules",
      bar: 1,
      spinning: true,
    });
    expect(f.run.first.rowBars).toBe(1);
    expect(f.run.first.buttons).toEqual([
      { text: "Running", disabled: true, spinner: 1 },
      { text: "Stop", disabled: false, spinner: 0 },
    ]);
    expect(f.run.footer.text).toBe(
      "Running Descriptions, Duplication and C.R.A.P.\u2026 Describing\u2026 0 of 1 modules",
    );
    expect(f.run.footer.buttons).toEqual(["bell"]);
    expect(f.run.footerAfter.text).toBe("");
    expect(f.run.footerAfter.buttons).toEqual(["bell"]);
    expect(f.run.first.rows.every((r: Facts) => r.disabled)).toBe(true);
  });

  it("moves each row on as it finishes and draws no bar once the run is over", () => {
    const row = (panel: Facts, key: string) =>
      panel.rows.find((r: Facts) => r.key === key);

    expect(row(f.run.afterDescribe, "duplication").state).toBe("running");
    expect(row(f.run.afterDescribe, "crap").state).toBe("running");
    expect(row(f.run.afterDuplication, "duplication").state).toBe(
      "current, just now",
    );
    expect(row(f.run.afterDuplication, "duplication").color).toBe(GREEN);
    expect(row(f.run.afterDuplication, "crap").state).toBe("running");
    expect(row(f.run.after, "duplication").state).toBe("current, just now");
    expect(f.run.after.header).toBe("Ran just now");
    expect(f.run.after.rowBars).toBe(0);
    expect(f.run.after.summary.bar).toBe(0);
    expect(f.run.after.summary.shape).not.toBe("running");
  });

  it("clears a tests-running tick after the scan it ran in and never writes it", () => {
    expect(f.run.crapTickAfter).toBe(false);
    expect(
      f.run.written.every((ticked: string[]) => !ticked.includes("crap")),
    ).toBe(true);
  });

  it("refuses a second scan while one runs", () => {
    expect(f.run.second).toEqual({
      status: "refused",
      reason: "a scan is already running",
    });
    expect(f.run.plans).toHaveLength(1);
  });

  it("stops a running scan from the Scan panel and leaves the footer empty", () => {
    expect(f.stopWhileRunning.order).toEqual(["scan-run", "scan-stop"]);
    expect(f.stopWhileRunning.count).toBe(1);
    expect(f.stop.footer).toBe("");
    expect(f.stop.footerButtons).toEqual(["bell"]);
    expect(f.stop.stopAfter).toBe(0);
    expect(f.stop.button).toBe("Run Descriptions");
    expect(f.stop.disabled).toBe(false);
  });

  it("disables every row's checkbox while a run is in progress, ignores a label click, and re-enables them on Stop", () => {
    expect(f.ticksWhileRunning.disabled.length).toBeGreaterThan(0);
    expect(f.ticksWhileRunning.disabled.every(Boolean)).toBe(true);
    expect(f.ticksWhileRunning.unchanged).toBe(true);
    expect(f.ticksWhileRunning.stopEnabled).toBe(true);
    expect(f.ticksAfterStop.length).toBeGreaterThan(0);
    expect(f.ticksAfterStop.filter(Boolean)).toHaveLength(1);
  });

  it("leaves a failed sensor at failed with its age and a log link in red and posts exactly one tray message", () => {
    const row = f.failed.rows.find((r: Facts) => r.key === "duplication");

    expect(row.state).toBe("failed, just now");
    expect(row.color).toBe(RED);
    expect(row.logLink).toBe("log");
    expect(f.failed.summary.shape).toBe("attention");
    expect(f.failed.summary.tone).toBe("bad");
    expect(f.failed.summary.bar).toBe(0);
    expect(f.failed.posted).toEqual(["duplication failed: broke"]);
    expect(f.failed.amber).toBeNull();
    expect(f.sensorFail.reasonLines).toBe(0);
  });

  it("shows a failed sensor row from the message's Show and opens the log from its Open log", () => {
    expect(f.sensorFail.footer.text).toBe("");
    expect(f.sensorFail.footer.buttons).toEqual(["bell"]);
    expect(f.sensorFail.messages).toEqual([
      {
        text: "duplication failed: broke",
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
      { text: "duplication failed: broke", actions: ["Show"] },
    ]);
  });

  it("shows a failed module from the message's Show on the inspector with the reason under its header", () => {
    expect(f.moduleFail.footer.buttons).toEqual(["bell"]);
    expect(f.moduleFail.messages).toEqual([
      {
        text: "Describe wrote 0 lines, 2 modules failed.",
        actions: ["Show", "Open log"],
      },
    ]);
    expect(f.moduleFail.header).toContain("a.py");
    expect(f.moduleFail.reason).toBe("no describer");
  });

  it("shows no text and no Describe button when a module has no line", () => {
    expect(f.missing.text).toBe("");
    expect(f.missing.describe).toBe(0);
  });

  it("lists Descriptions and the third-party rows, none disabled, when the shipped list is unavailable", () => {
    expect(f.down).toEqual([
      { name: "Structure", disabled: true },
      { name: "Descriptions", disabled: false },
      { name: "alpha", disabled: false },
      { name: "beta", disabled: false },
    ]);
  });

  it("renders only the header while the shipped list is being read, then every row at once", () => {
    expect(f.pending).toEqual({
      header: "Ran just now",
      rows: 0,
      buttons: 0,
      list: 0,
    });
    expect(f.loaded.rows).toEqual(NAMES);
    expect(f.loaded.buttons).toBe(2);
  });

  it("says why each sensor could not run fully, one second line per mock state", () => {
    const r = f.reasons;

    expect(r.crapRed.state).toMatch(/^current/);
    expect(r.crapRed.tone).toBe("ok");
    expect(r.crapRed.why).toBe("3 tests failed, so coverage may read low.");
    expect(r.crapRed).toMatchObject({ copy: null, log: "Show log", chips: [] });
    expect(r.crapNoCov.state).toMatch(/^current/);
    expect(r.crapNoCov.chips).toEqual(["cargo install cargo-llvm-cov"]);
    expect(r.crapNoCov).toMatchObject({ copy: "Copy", log: null });
    expect(r.crapNoRun.state).toMatch(/^failed/);
    expect(r.crapNoRun.tone).toBe("bad");
    expect(r.crapNoRun.why).toBe(
      "pytest is not in this repository's environment. Add it with uv add --dev pytest.",
    );
    expect(r.crapNoRun.chips).toEqual(["uv add --dev pytest"]);
    expect(r.crapNoRun).toMatchObject({ copy: "Copy", log: null });
    expect(r.mutationRed.state).toMatch(/^failed/);
    expect(r.mutationRed.tone).toBe("bad");
    expect(r.mutationRed.chips).toEqual(["tests/test_orders.py::test_refund"]);
    expect(r.mutationRed).toMatchObject({ copy: null, log: "Show log" });
    expect(r.mutationNoCov.state).toMatch(/^failed/);
    expect(r.mutationNoCov).toMatchObject({ copy: "Copy", log: null });
  });

  it("keeps each second line inside its row and clear of the next row", () => {
    const r = f.reasons;

    for (const one of [
      r.crapRed,
      r.crapNoCov,
      r.crapNoRun,
      r.mutationRed,
      r.mutationNoCov,
    ]) {
      expect(one.inside).toBe(true);
      expect(one.clear).not.toBe(false);
    }
  });

  it("opens the sensors' log through the editor and copies the bare fix", () => {
    expect(f.reasons.opened).toEqual([
      ".recognizer/cache/coverage/last-run.log",
    ]);
    expect(f.reasons.copied).toEqual(["cargo install cargo-llvm-cov"]);
  });

  it("shows a refusal remembered from the run log after a restart, with its reason, Copy and Show log, and nothing else changes", () => {
    const r = f.restart;

    expect(r.refused.state).toMatch(/^failed/);
    expect(r.refused.tone).toBe("bad");
    expect(r.refused.why).toBeTruthy();
    expect(r.refused.log).toBe("Show log");
    expect(r.copy.copy).toBe("Copy");
    expect(r.refused.inside).toBe(true);

    for (const one of [r.okNewer, r.none, r.older, r.tie]) {
      expect(one.state).toMatch(/^current/);
      expect(one.why).toBeNull();
    }
  });

  it("shows failed and no second line for a failure with no diagnosis", () => {
    expect(f.reasons.plain.state).toMatch(/^failed/);
    expect(f.reasons.plain.why).toBeNull();
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
