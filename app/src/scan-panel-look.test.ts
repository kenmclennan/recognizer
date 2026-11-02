import { beforeAll, describe, expect, it } from "vitest";
import { chrome, collectFacts, FAKE_WORKER, here } from "./look-page";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { showExplorer } from ${JSON.stringify(here("explorer.ts"))};
import { fakeViews } from ${JSON.stringify(here("views-fake.ts"))};
import { fakeSensors } from ${JSON.stringify(here("sensors-fake.ts"))};
import { fakeEditor } from ${JSON.stringify(here("editor-fake.ts"))};
import { fakeResponsibilities } from ${JSON.stringify(here("responsibilities-fake.ts"))};
import { fakeScan } from ${JSON.stringify(here("scan-fake.ts"))};
import { buildFooter } from ${JSON.stringify(here("footer-view.ts"))};
import { createRescanner } from ${JSON.stringify(here("rescanner.ts"))};
import { withSensors } from ${JSON.stringify(here("sensor-run.ts"))};
import { NO_CHANGES } from ${JSON.stringify(here("footer-scan.ts"))};
import { describerOf, registeredNames } from ${JSON.stringify(here("scan-panel-model.ts"))};
import { showTarget } from ${JSON.stringify(here("scan-progress.ts"))};
${FAKE_WORKER}

const ids = ["app/a.py", "app/b.py"];
const scan = {
  commit: "cur1234",
  modules: ids.map((id) => ({ id, kind: "module" })),
  edges: [{ from: ids[0], to: ids[1], kind: "depends", line: 1, names: ["X"] }],
  foreign: [],
};
const base = { modules: ids, scans: [{ file: "scan.python.json", scan }], policy: null, baseline: null, notices: [], blocking: null, findings: [], sensors: [], folderMetrics: [] };
const CONFIG = "describer:\\n  command: [recognizer-describe-claude]\\n  version: v3\\nsensors:\\n  alpha:\\n    command: [node, '{repository}/a.mjs', '{commit}', '{output}']\\n  beta:\\n    command: [node, '{repository}/b.mjs', '{commit}', '{output}']\\n";
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

async function mount(fake, sensors = fakeSensors({}, { config: CONFIG })) {
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
  const wired = { explorer: null, current: null, scanState: null, shown: { footer: null, target: null, log: null }, rescanner: null };
  const canShow = (update) => update.target !== null && (update.target.kind === "sensor" || wired.current.modules.includes(update.target.id));
  const withProgress = (state) => ({ ...state, progress: wired.shown.footer, canShow: canShow(wired.shown), log: wired.shown.log });
  const footer = buildFooter(footerEl, {
    rescan: () => void wired.rescanner.run(),
    stop: () => void wired.rescanner.stop(),
    show: () => { const target = showTarget(wired.rescanner.progress()); if (target !== null) wired.explorer.show(target); },
    openLog: () => { if (wired.shown.log !== null) void editor.openFile(wired.shown.log); },
  });
  const scanHost = {
    port: sensors,
    scan: () => wired.scanState,
    ticks: () => wired.rescanner.ticks(),
    setTicks: (next) => wired.rescanner.setTicks(next),
    runState: () => wired.rescanner.runState(),
    running: () => wired.rescanner.running(),
    run: () => void wired.rescanner.run(),
    stop: () => void wired.rescanner.stop(),
  };
  const build = (loaded, carried) => {
    wired.current = loaded;
    return showExplorer(host, loaded, "demo", () => {}, fakeViews({}), () => {}, carried, undefined, { getItem: () => null, setItem: () => {} }, editor, responsibilities, undefined, undefined, scanHost);
  };
  const setScan = (next) => { wired.scanState = next; footer.setScan(next); };
  wired.rescanner = createRescanner({
    port: fake,
    registered: async () => { const { config } = await sensors.readInputs(); return { names: registeredNames(config), describer: describerOf(config) !== null }; },
    load: () => base,
    sense: (loaded) => withSensors(loaded, sensors),
    resense: async () => withSensors(wired.current, sensors),
    adopt: async () => ORIGIN,
    carry: () => wired.explorer?.carry() ?? null,
    replace: (loaded, carried) => { wired.explorer?.dispose(); wired.explorer = build(loaded, carried); },
    adopted: (origin) => setScan(withProgress({ origin, scannedAt: Date.now(), changes: NO_CHANGES })),
    describedLine: () => wired.explorer?.refreshResponsibilities(),
    progress: (update) => { wired.shown = update; if (wired.scanState !== null) setScan(withProgress(wired.scanState)); wired.explorer?.refreshPanel(); },
    settled: () => {},
    blocked: (text) => { footer.notify("Rescan failed: " + text); },
    notify: (text) => footer.notify(text),
  });
  await wired.rescanner.loadTicks();
  wired.current = base;
  setScan(withProgress({ origin: ORIGIN, scannedAt: Date.now(), changes: NO_CHANGES }));
  wired.explorer = build(await withSensors(base, sensors), null);
  await tick();

  const q = (selector) => root.querySelector(selector);
  const all = (selector) => [...root.querySelectorAll(selector)];
  const visible = (selector) => { const n = q(selector); return n !== null && getComputedStyle(n).display !== "none"; };
  const rows = () => all(".sensor-row").map((r) => ({ name: r.querySelector(".sensor-name").textContent, chip: r.querySelector(".sensor-chip").textContent, ticks: r.querySelectorAll(".sensor-tick").length }));
  const text = (selector) => q(selector)?.textContent ?? "<missing " + selector + ">";
  const footerText = () => q(".scan-line").textContent;
  const setTick = async (selector, checked) => { const box = q(selector); box.checked = checked; box.dispatchEvent(new Event("change", { bubbles: true })); await tick(); };

  return { host, q, all, visible, rows, text, footerText, setTick, fake, editor, wired, sensors };
}

(async () => {
  const facts = {};

  const fake = fakeScan();
  const a = await mount(fake);
  click(a.q(".rail-scan"));
  await tick();

  facts.idle = {
    order: a.all(".rail button").map((b) => b.className.split(" ")[1]),
    panel: a.visible(".scan-panel"),
    files: a.visible(".tree-header"),
    ran: fake.ran.length,
    titleAttr: a.q(".rail-scan").title,
    label: getComputedStyle(a.q(".rail-scan"), "::after").content,
    head: a.text(".scan-head"),
    extract: a.text(".scan-extract"),
    extractTicks: a.all(".scan-extract input").length,
    describe: a.text(".scan-describe"),
    rows: a.rows(),
    button: a.text(".scan-run"),
    buttonTitle: (a.q(".scan-run")?.title ?? ""),
    summary: a.text(".scan-summary"),
  };

  await a.setTick('.scan-describe .scan-tick', true);
  await a.setTick('.scan-sensors .scan-tick', true);
  facts.ticked = { button: a.text(".scan-run"), summary: a.text(".scan-summary"), buttonTitle: (a.q(".scan-run")?.title ?? ""), written: fake.written };

  const b = await mount(fake);
  click(b.q(".rail-scan"));
  await tick();
  facts.reopened = { describeTick: b.q(".scan-describe .scan-tick").checked, sensorsTick: b.q(".scan-sensors .scan-tick").checked };

  const g1 = gate(); const g2 = gate(); const g3 = gate();
  fake.steps = [current, describing(2), entry("describe", "app/a.py"), g1.promise, entry("describe", "app/b.py"), sensing(2), g2.promise, entry("sense", "alpha"), g3.promise, entry("sense", "beta"), summary];
  const footers = [];
  fake.onStep = () => { const text = b.footerText(); const base = text.replace(/Stop|Rescan/g, ""); if (footers.at(-1) !== base) footers.push(base); };
  click(b.q(".scan-run"));
  await tick();
  facts.run = { plans: fake.ran, footers, during: { button: b.q(".scan-stop-button")?.textContent ?? "", rescanDisabled: b.q(".rescan-button")?.disabled ?? null }, stopButtons: b.all(".scan-line .scan-stop").length };
  facts.run.second = await fake.run({ describe: false, sense: [] });
  g1.release(); await tick();
  facts.run.rowDuring = b.rows().slice(1).map((r) => r.chip);
  g2.release(); await tick();
  g3.release(); await tick(); await tick();
  facts.run.after = { footer: b.footerText(), button: b.text(".scan-run") };
  facts.run.footers = footers.map((text) => text.replace(/^Scan done.*/, "")).filter((text) => text !== "");

  const stopGate = gate();
  const sfake = fakeScan({ steps: [current, describing(2), stopGate.promise] });
  const s = await mount(sfake);
  click(s.q(".rail-scan"));
  await tick();
  click(s.q(".scan-run"));
  await tick();
  click(s.q(".scan-stop-button"));
  await tick(); await tick();
  facts.stop = { footer: s.footerText(), button: s.q(".scan-run")?.textContent ?? "" };

  const sensorFake = fakeScan({
    defaults: { describe: false, sensors: true },
    steps: [current, sensing(2), entry("sense", "alpha", "broke"), entry("sense", "beta", "broke"), summary],
    result: { status: "finished", exitCode: 1, stderr: "", log: ".recognizer/cache/log/x-scan.json" },
  });
  const t = await mount(sensorFake);
  click(t.q(".rail-scan"));
  await tick();
  click(t.q(".scan-run"));
  await tick(); await tick();
  click(t.q(".rail-files"));
  await tick();
  const failedFooter = t.footerText();
  const hiddenBefore = !t.visible(".scan-panel");
  click(t.q(".scan-show"));
  await tick();
  const dot = t.q(".rail-scan .rail-dot");
  click(t.q(".scan-open-log"));
  await tick();
  facts.sensorFail = {
    footer: failedFooter,
    hiddenBefore,
    panelOpen: t.visible(".scan-panel"),
    reason: t.q('[data-sensor="alpha"] .sensor-reason')?.textContent ?? "",
    dot: dot !== null && !dot.hidden && getComputedStyle(dot).display !== "none",
    opened: t.editor.files,
  };

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
  const moduleFooter = m.footerText();
  click(m.q(".scan-show"));
  await tick();
  facts.moduleFail = {
    footer: moduleFooter,
    header: m.q(".inspector")?.textContent ?? "",
    reason: m.q(".responsibility .finding.warning")?.textContent ?? "",
  };
  facts.missing = { text: m.q(".responsibility")?.textContent ?? "", describe: m.all(".responsibility .describe").length };

  const SHIPPED = [{ name: "duplication", line: "Finds repeated structure.", defaults: { threshold: 0.82 } }];
  const addSensors = fakeSensors({}, { config: CONFIG }, {}, SHIPPED);
  const ad = await mount(fakeScan(), addSensors);
  click(ad.q(".rail-scan"));
  await tick();
  const listed = () => ad.all(".sensor-add").map((r) => r.querySelector(".sensor-name").textContent + " | " + r.querySelector(".sensor-add-line").textContent);
  const removes = () => ad.all(".sensor-row .sensor-remove").map((b) => b.getAttribute("aria-label"));
  const names = () => ad.rows().map((r) => r.name);
  facts.addRow = { listed: listed(), removes: removes(), title: ad.text(".sensor-add-title") };
  click(ad.q(".sensor-add-button"));
  await tick(); await tick();
  facts.added = { edits: [...addSensors.edits], config: addSensors.inputs.config, names: names(), listed: listed(), removes: removes() };
  click(ad.q('.sensor-row[data-sensor="duplication"] .sensor-remove'));
  await tick(); await tick();
  facts.removed = { edits: [...addSensors.edits], names: names(), listed: listed(), removes: removes() };
  addSensors.failEdit = true;
  click(ad.q(".sensor-add-button"));
  await tick(); await tick();
  facts.addFailed = { message: ad.text(".sensor-add-message"), names: names() };

  const busyGate = gate();
  const busySensors = fakeSensors({}, { config: CONFIG }, {}, SHIPPED);
  const busy = await mount(fakeScan({ steps: [current, busyGate.promise] }), busySensors);
  click(busy.q(".rail-scan"));
  await tick();
  click(busy.q(".scan-run"));
  await tick();
  facts.addBusy = { add: busy.q(".sensor-add-button")?.disabled ?? null };

  const downSensors = fakeSensors({}, { config: CONFIG }, {}, { status: "unavailable", reason: "recognizer is not installed" });
  const down = await mount(fakeScan(), downSensors);
  click(down.q(".rail-scan"));
  await tick();
  facts.addDown = { text: down.text(".sensor-add-unavailable"), buttons: down.all(".sensor-add-button").length };

  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Facts = ReturnType<typeof JSON.parse>;

describe.skipIf(chrome === undefined)("the Scan panel", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = await collectFacts<Facts>(HARNESS, "scan-panel");
  }, 180000);

  it("sits third on the rail as Scan, swaps with the tree and runs nothing on open", () => {
    expect(f.idle.order).toEqual([
      "rail-files",
      "rail-notes",
      "rail-scan",
      "rail-findings",
    ]);
    expect(f.idle.panel).toBe(true);
    expect(f.idle.files).toBe(false);
    expect(f.idle.ran).toBe(0);
    expect(f.idle.titleAttr).toBe("");
    expect(f.idle.label).toContain("Scan");
  });

  it("shows the head, the Extract block with no tick, the Describe counts and the Sensors rows", () => {
    expect(f.idle.head).toContain("cur1234");
    expect(f.idle.extract).toContain("python");
    expect(f.idle.extract).toContain("2 modules");
    expect(f.idle.extractTicks).toBe(0);
    expect(f.idle.describe).toContain("0 current");
    expect(f.idle.describe).toContain("2 missing");
    expect(f.idle.describe).toContain("recognizer-describe-claude v3");
    expect(f.idle.rows).toEqual([
      expect.objectContaining({
        name: "structure",
        chip: "every scan",
        ticks: 0,
      }),
      expect.objectContaining({ name: "alpha", chip: "not run", ticks: 1 }),
      expect.objectContaining({ name: "beta", chip: "not run", ticks: 1 }),
    ]);
  });

  it("labels the button Scan, summarises what it will run beside it and shows the command line as its tooltip", () => {
    expect(f.idle.button).toBe("Scan");
    expect(f.idle.summary).toBe("scans current");
    expect(f.idle.buttonTitle).toBe("recognizer scan");
    expect(f.ticked.button).toBe("Scan");
    expect(f.ticked.summary).toBe("scans current, describe, 2 sensors");
    expect(f.ticked.buttonTitle).toBe(
      "recognizer scan --describe --sense alpha,beta",
    );
  });

  it("remembers a tick through the port and a window reopened on the same port reads it back", () => {
    expect(f.ticked.written.at(-1)).toEqual({
      describe: true,
      sensors: true,
      ticked: ["alpha", "beta"],
    });
    expect(f.reopened.describeTick).toBe(true);
    expect(f.reopened.sensorsTick).toBe(true);
  });

  it("runs the ticked plan from the Scan button, which becomes Stop, and walks the footer through the phases", () => {
    expect(f.run.plans).toEqual([{ describe: true, sense: ["alpha", "beta"] }]);
    expect(f.run.during.button).toBe("Stop");
    expect(f.run.footers).toEqual([
      "Scans current",
      "Describing 0 of 2",
      "Describing 1 of 2",
      "Describing 2 of 2",
      "Sensors 0 of 2",
      "Sensors 1 of 2",
      "Sensors 2 of 2",
    ]);
    expect(f.run.stopButtons).toBe(1);
    expect(f.run.during.rescanDisabled).toBe(true);
    expect(f.run.rowDuring).toEqual(["running", "running"]);
    expect(f.run.after.footer).toContain("Scan done");
    expect(f.run.after.button).toBe("Scan");
  });

  it("refuses a second scan while one runs", () => {
    expect(f.run.second).toEqual({
      status: "refused",
      reason: "a scan is already running",
    });
    expect(f.run.plans).toHaveLength(1);
  });

  it("stops a running scan and says Stopped", () => {
    expect(f.stop.footer).toContain("Stopped");
    expect(f.stop.button).toBe("Scan");
  });

  it("shows a failed sensor row from Show with its reason, and opens the log in the editor", () => {
    expect(f.sensorFail.footer).toBe(
      "Sensors failed: brokeRescan\u00b7Show\u00b7Open log",
    );
    expect(f.sensorFail.panelOpen).toBe(true);
    expect(f.sensorFail.reason).toBe("broke");
    expect(f.sensorFail.dot).toBe(true);
    expect(f.sensorFail.opened).toEqual([".recognizer/cache/log/x-scan.json"]);
  });

  it("shows a failed module from Show on the inspector with the reason under its header", () => {
    expect(f.moduleFail.footer).toBe(
      "Describe failed: no describerRescan\u00b7Show\u00b7Open log",
    );
    expect(f.moduleFail.header).toContain("a.py");
    expect(f.moduleFail.reason).toBe("no describer");
  });

  it("offers Describe for a module whose line is missing", () => {
    expect(f.missing.text).toContain("No responsibility line yet");
    expect(f.missing.describe).toBe(1);
  });

  it("lists an unregistered shipped sensor under Add a sensor with its line, and Remove only on a registered shipped one", () => {
    expect(f.addRow.title).toBe("Add a sensor");
    expect(f.addRow.listed).toEqual([
      "duplication | Finds repeated structure.",
    ]);
    expect(f.addRow.removes).toEqual([]);
  });

  it("writes the entry on Add, shows the registered row with Remove, and returns it to the list on Remove", () => {
    expect(f.added.edits).toEqual([{ name: "duplication", add: true }]);
    expect(f.added.config).toContain("duplication: {}");
    expect(f.added.names).toEqual([
      "structure",
      "duplication",
      "alpha",
      "beta",
    ]);
    expect(f.added.listed).toEqual([]);
    expect(f.added.removes).toEqual(["Remove duplication"]);
    expect(f.removed.edits).toEqual([
      { name: "duplication", add: true },
      { name: "duplication", add: false },
    ]);
    expect(f.removed.names).toEqual(["structure", "alpha", "beta"]);
    expect(f.removed.listed).toEqual([
      "duplication | Finds repeated structure.",
    ]);
    expect(f.removed.removes).toEqual([]);
  });

  it("shows the message when the edit fails and leaves the rows as they were", () => {
    expect(f.addFailed.message).toContain("config.yaml is read-only");
    expect(f.addFailed.names).toEqual(["structure", "alpha", "beta"]);
  });

  it("disables Add while a scan runs", () => {
    expect(f.addBusy.add).toBe(true);
  });

  it("says why the list is unavailable and offers no Add", () => {
    expect(f.addDown.text).toContain("recognizer is not installed");
    expect(f.addDown.buttons).toBe(0);
  });
});
