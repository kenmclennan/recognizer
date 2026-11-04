import { beforeAll, describe, expect, it } from "vitest";
import { chrome, collectFacts, FAKE_WORKER, here } from "./look-page";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { loadedOf, registeredOf, scanHostOf, mountExplorer } from ${JSON.stringify(here("look-support.ts"))};
import { fakeViews } from ${JSON.stringify(here("views-fake.ts"))};
import { fakeSensors } from ${JSON.stringify(here("sensors-fake.ts"))};
import { fakeEditor } from ${JSON.stringify(here("editor-fake.ts"))};
import { fakeResponsibilities } from ${JSON.stringify(here("responsibilities-fake.ts"))};
import { fakeScan } from ${JSON.stringify(here("scan-fake.ts"))};
import { buildFooter } from ${JSON.stringify(here("footer-view.ts"))};
import { createRescanner } from ${JSON.stringify(here("rescanner.ts"))};
import { withSensors } from ${JSON.stringify(here("sensor-run.ts"))};
import { NO_CHANGES } from ${JSON.stringify(here("footer-scan.ts"))};
import { rowSensors } from ${JSON.stringify(here("scan-panel-model.ts"))};
${FAKE_WORKER}

const ids = ["app/a.py", "app/b.py"];
const scan = {
  commit: "cur1234",
  modules: ids.map((id) => ({ id, kind: "module" })),
  edges: [{ from: ids[0], to: ids[1], kind: "depends", line: 1, names: ["X"] }],
  foreign: [],
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

async function mount(fake, sensors = fakeSensors({}, { config: CONFIG }, {}, SHIPPED), scanned = true) {
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
  const responsibilities = fakeResponsibilities(FILES);
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
    run: () => void wired.rescanner.run(),
    stop: () => void wired.rescanner.stop(),
    refresh: () => void wired.rescanner.refresh(),
  });
  const build = (loaded, carried) => {
    wired.current = loaded;
    return mountExplorer({ container: host, loaded, title: "demo", views: fakeViews({}), post: (input) => { wired.posted.push(input); return null; }, carried, storage: { getItem: () => null, setItem: () => {} }, editor, responsibilities, scanHost });
  };
  const setScan = (next) => { wired.scanState = next; footer.setScan(next); };
  wired.rescanner = createRescanner({
    port: fake,
    registered: async () => { const { config } = await sensors.readInputs(); return registeredOf(rowSensors(config, await sensors.shipped())); },
    load: () => base,
    sense: (loaded) => withSensors(loaded, sensors),
    resense: async () => withSensors(wired.current, sensors),
    adopt: async () => ORIGIN,
    carry: () => wired.explorer?.carry() ?? null,
    replace: (loaded, carried) => { wired.explorer?.dispose(); wired.explorer = build(loaded, carried); },
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
  const rows = () => all(".scan-row").map((r) => ({ key: r.dataset.sensor, name: r.querySelector(".scan-row-label").textContent, state: r.querySelector(".scan-state").textContent, tone: r.querySelector(".scan-state").className.replace("scan-state", "").trim(), color: getComputedStyle(r.querySelector(".scan-state")).color, title: r.dataset.tip, ticked: r.querySelector(".scan-tick").checked, disabled: r.querySelector(".scan-tick").disabled, accent: getComputedStyle(r.querySelector(".scan-tick")).accentColor, spinner: r.querySelectorAll(".scan-state svg").length }));
  const text = (selector) => q(selector)?.textContent ?? "<missing " + selector + ">";
  const footerText = () => q(".scan-line").textContent;
  const footerButtons = () => all(".footer button").filter((b) => !b.closest(".message-tray, .message-toast")).map((b) => b.className);
  const messages = () => all(".message-list .msg").map((m) => ({ text: m.querySelector(".msg-text").textContent, actions: [...m.querySelectorAll(".msg-act")].map((b) => b.textContent) }));
  const message = (contains) => all(".message-list .msg").find((m) => m.querySelector(".msg-text").textContent.includes(contains));
  const act = (contains, label) => click([...message(contains).querySelectorAll(".msg-act")].find((b) => b.textContent === label));
  const setTick = async (key, checked) => { const box = q('.scan-row[data-sensor="' + key + '"] .scan-tick'); box.checked = checked; box.dispatchEvent(new Event("change", { bubbles: true })); await tick(); };
  const panel = () => ({ header: q(".scan-sub").textContent, amber: q(".scan-sub .warn")?.textContent ?? null, amberColor: q(".scan-sub .warn") ? getComputedStyle(q(".scan-sub .warn")).color : null, rows: rows(), buttons: all(".scan-buttons button").map((b) => ({ text: b.textContent, disabled: b.disabled, spinner: b.querySelectorAll("svg").length })), strays: all(".scan-block, .scan-block-title, .sensor-add, .sensor-remove, .scan-summary, .scan-stop-button, .scan-panel h2, .scan-panel h3, .scan-extract, .scan-describe, .measure-row").length, subLines: all(".scan-row *").filter((n) => n.matches("div")).length });

  return { host, q, all, visible, rows, text, footerText, footerButtons, messages, act, setTick, panel, fake, editor, wired, sensors };
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
  fake.onStep = (index) => { if ([1, 3, 5, 8].includes(index)) { during.push(c.panel()); duringFooter.push({ text: c.footerText(), buttons: c.footerButtons() }); } if (index === 6) c.sensors.files.set("duplication", json({ findings_version: 1, sensor: { name: "duplication", version: "1" }, commit: "cur1234", modified: false, settings: {}, findings: [] })); };
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
  facts.run.footerAfter = { text: c.footerText(), buttons: c.footerButtons() };
  facts.run.written = fake.written.map((w) => w.ticked);
  facts.run.crapTickAfter = c.rows().find((r) => r.key === "crap").ticked;

  const stopGate = gate();
  const sfake = fakeScan({ steps: [current, describing(2), stopGate.promise] });
  const s = await mount(sfake);
  click(s.q(".rail-scan"));
  await tick();
  click(s.q(".scan-run"));
  await tick();
  facts.stopWhileRunning = { count: s.all(".scan-buttons .scan-stop").length, buttons: s.panel().buttons, order: s.all(".scan-buttons button").map((b) => b.className.split(" ")[0]) };
  click(s.q(".scan-stop"));
  await tick(); await tick();
  facts.stop = { footer: s.footerText(), footerButtons: s.footerButtons(), stopAfter: s.all(".scan-stop").length, button: s.q(".scan-run")?.textContent ?? "", disabled: s.q(".scan-run")?.disabled };

  const changed = await mount(fakeScan());
  changed.wired.scanState = { ...changed.wired.scanState, scannedAt: Date.now() - 2 * 3600000, changes: { files: ["app/a.py"], moved: null } };
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
  const failedFooter = { text: t.footerText(), buttons: t.footerButtons() };
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
  const moduleFooter = { text: m.footerText(), buttons: m.footerButtons() };
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

  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Facts = ReturnType<typeof JSON.parse>;

const GREEN = "rgb(26, 127, 55)";
const AMBER = "rgb(191, 135, 0)";
const ACCENT = "rgb(9, 105, 218)";
const MUTED = "rgb(89, 99, 110)";
const NAMES = [
  "Descriptions",
  "C.R.A.P.",
  "Duplication",
  "Mutation",
  "alpha",
  "beta",
];

const names = (panel: Facts) => panel.rows.map((r: Facts) => r.name);
const states = (panel: Facts) => panel.rows.map((r: Facts) => r.state);

describe.skipIf(chrome === undefined)("the Scan panel", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = await collectFacts<Facts>(HARNESS, "scan-panel");
  }, 180000);

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

  it("matches the mock's fresh repository: Not scanned yet, one list, nothing ticked, every row not yet run", () => {
    expect(f.fresh.header).toBe("Not scanned yet");
    expect(names(f.fresh)).toEqual(NAMES);
    expect(states(f.fresh)).toEqual([
      "2 to describe",
      ...Array(5).fill("not yet run"),
    ]);
    expect(f.fresh.rows.every((r: Facts) => !r.ticked)).toBe(true);
    expect(f.fresh.rows.every((r: Facts) => r.color === MUTED)).toBe(true);
  });

  it("has no heading, sub-line, Remove button, Add block, summary or disabled checkbox, and an accent-coloured checkbox", () => {
    expect(f.fresh.strays).toBe(0);
    expect(f.fresh.subLines).toBe(0);
    expect(f.fresh.rows.every((r: Facts) => !r.disabled)).toBe(true);
    expect(f.fresh.rows.every((r: Facts) => r.accent === ACCENT)).toBe(true);
  });

  it("titles each row with its one-sentence description and prints nothing under it", () => {
    expect(f.fresh.rows[0].title).toBe(
      "Writes one line per module saying what it is responsible for.",
    );
    expect(f.fresh.rows[1].title).toBe(
      "C.R.A.P.: Change Risk Anti-Patterns. Runs the tests with coverage.",
    );
    expect(f.fresh.rows[2].title).toBe("Finds repeated structure.");
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

  it("has one primary Scan button alone, with no text beside it", () => {
    expect(f.fresh.buttons).toEqual([
      { text: "Run", disabled: false, spinner: 0 },
    ]);
    expect(f.fresh.buttonTitle).toBe("");
  });

  it("matches the mock after a scan: Scanned with an age and no sha or counts", () => {
    expect(f.scanned.header).toBe("Ran just now");
    expect(f.scanned.amber).toBeNull();
  });

  it("matches the mock with files changed: the phrase after the dot in amber", () => {
    expect(f.changed.header).toBe("Ran 2 hours ago \u00b7 files changed since");
    expect(f.changed.amber).toBe("files changed since");
    expect(f.changed.amberColor).toBe(AMBER);
  });

  it("remembers a tick through the port, never a tests-running sensor, and a reopened window reads it back", () => {
    expect(f.ticked.rows).toEqual(["describe", "crap", "duplication"]);
    expect(f.ticked.written).toEqual({
      describe: true,
      ticked: ["duplication"],
    });
    expect(f.reopened).toEqual(["describe", "duplication"]);
  });

  it("matches the mock while running: Scanning…, one running row with a spinner, the rest waiting, a disabled Scanning button and a Stop beside it", () => {
    expect(f.run.plans).toEqual([
      { describe: true, sense: ["duplication", "crap"] },
    ]);
    expect(f.run.first.header).toBe("Scanning\u2026");
    expect(
      f.run.first.rows
        .filter((r: Facts) => r.spinner > 0)
        .map((r: Facts) => r.key),
    ).toEqual(["describe"]);
    expect(f.run.first.rows.map((r: Facts) => r.state).slice(0, 3)).toEqual([
      "running",
      "waiting",
      "waiting",
    ]);
    expect(f.run.first.rows[0].color).toBe(ACCENT);
    expect(f.run.first.rows[1].color).toBe(MUTED);
    expect(f.run.first.buttons).toEqual([
      { text: "Running", disabled: true, spinner: 1 },
      { text: "Stop", disabled: false, spinner: 0 },
    ]);
    expect(f.run.footer.text).toBe("Describing\u2026 0 of 1 modules");
    expect(f.run.footer.buttons).toEqual(["bell"]);
    expect(f.run.footerAfter.text).toBe("Scanned at cur1234, just now");
    expect(f.run.footerAfter.buttons).toEqual(["bell"]);
    expect(f.run.after.buttons).toEqual([
      { text: "Run", disabled: false, spinner: 0 },
    ]);
    expect(f.run.first.rows.every((r: Facts) => !r.disabled)).toBe(true);
  });

  it("moves running to the started sensor and leaves finished rows with their results", () => {
    const row = (panel: Facts, key: string) =>
      panel.rows.find((r: Facts) => r.key === key);

    expect(row(f.run.afterDescribe, "duplication").state).toBe("running");
    expect(row(f.run.afterDescribe, "crap").state).toBe("waiting");
    expect(row(f.run.afterDuplication, "duplication").state).toBe(
      "0 findings, just now",
    );
    expect(row(f.run.afterDuplication, "duplication").color).toBe(GREEN);
    expect(row(f.run.afterDuplication, "crap").state).toBe("running");
    expect(row(f.run.after, "describe").state).toMatch(
      /modules? described|to describe|not yet run/,
    );
    expect(row(f.run.after, "duplication").state).toBe("0 findings, just now");
    expect(f.run.after.header).toBe("Ran just now");
    expect(f.run.after.buttons).toEqual([
      { text: "Run", disabled: false, spinner: 0 },
    ]);
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

  it("stops a running scan from the Scan panel and leaves the footer reading Scanned", () => {
    expect(f.stopWhileRunning.order).toEqual(["scan-run", "scan-stop"]);
    expect(f.stopWhileRunning.count).toBe(1);
    expect(f.stop.footer).toContain("Scanned");
    expect(f.stop.footerButtons).toEqual(["bell"]);
    expect(f.stop.stopAfter).toBe(0);
    expect(f.stop.button).toBe("Run");
    expect(f.stop.disabled).toBe(false);
  });

  it("leaves a failed sensor at failed with its age in amber and posts exactly one tray message", () => {
    const row = f.failed.rows.find((r: Facts) => r.key === "duplication");

    expect(row.state).toBe("failed, just now");
    expect(row.color).toBe(AMBER);
    expect(f.failed.posted).toEqual(["duplication failed: broke"]);
    expect(f.failed.amber).toBeNull();
    expect(f.sensorFail.reasonLines).toBe(0);
  });

  it("shows a failed sensor row from the message's Show and opens the log from its Open log", () => {
    expect(f.sensorFail.footer.text).toBe("Scanned at cur1234, just now");
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
    expect(f.loaded.rows).toEqual([
      "Descriptions",
      "C.R.A.P.",
      "Duplication",
      "Mutation",
      "alpha",
      "beta",
    ]);
    expect(f.loaded.buttons).toBe(1);
  });

  it("lists a report after the list with no checkbox, its age and short commit, and a Clear button that deletes it", () => {
    expect(f.report.names).toEqual(NAMES);
    expect(f.report.listCount).toBe(6);
    expect(f.report.ticks).toBe(0);
    expect(f.report.chip).toBe("reported 3 minutes ago");
    expect(f.report.commit).toBe("feed123");
    expect(f.report.clear).toBe("Clear");
    expect(f.report.afterList).toBe(true);
    expect(f.reportCleared.removed).toEqual(["review"]);
    expect(f.reportCleared.present).toBe(false);
  });
});
