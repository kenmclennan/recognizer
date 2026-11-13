import { beforeAll, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../scripts/pool-scale.mjs";
import { collectFacts, FAKE_WORKER, here, webkit } from "./look-page";
import { shippedSensor } from "./shipped-fake";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const H1 = "1".repeat(64);
const H2 = "2".repeat(64);
const TESTS = "a".repeat(64);
const MEASURE = process.env.RECOGNIZER_MEASURE_PROGRESS === "1";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { loadedOf, mountExplorer, scanHostOf } from ${JSON.stringify(here("look-support.ts"))};
import { fakeSensors } from ${JSON.stringify(here("sensors-fake.ts"))};
${FAKE_WORKER}

const realNow = Date.now.bind(Date);
let skew = 0;
Date.now = () => realNow() + skew;
const ageTicks = [];
const realSetInterval = window.setInterval.bind(window);
window.setInterval = (fn, ms, ...rest) => (ms === 60000 ? (ageTicks.push(fn), 0) : realSetInterval(fn, ms, ...rest));

const ids = ["app/a.py", "app/b.py"];
const members = [{ name: "f", kind: "function", exported: true, line: 1, params: [], returns: "int" }];
const scan = {
  commit: ${JSON.stringify(COMMIT)},
  modified: false,
  files: [{ path: "app/a.py", hash: ${JSON.stringify(H1)} }, { path: "app/b.py", hash: ${JSON.stringify(H2)} }],
  modules: ids.map((id) => ({ id, kind: "module", members })),
  edges: [],
  foreign: [],
};
const inputs = { "app/a.py": ${JSON.stringify(H1)}, "app/b.py": ${JSON.stringify(H2)} };
const overlay = JSON.stringify({ overlay_version: 2, commit: ${JSON.stringify(COMMIT)}, modified: false, inputs, tests: ${JSON.stringify(TESTS)}, producer: { name: "crap", version: "0.1.0" }, metrics: [{ name: "complexity", type: "count", granularity: "member", bad: "high" }], values: { complexity: { "app/a.py::f": 8, "app/b.py::f": 5 } } });
const loaded = loadedOf({ modules: ids, scans: [{ file: "scan.json", scan }], overlays: [{ name: "crap", text: overlay, modifiedMs: Date.now() }], sensors: [{ name: "crap", status: "ran", measured: { inputs, tests: ${JSON.stringify(TESTS)} } }], tests: ${JSON.stringify(TESTS)} });
const SHIPPED = ${JSON.stringify([{ ...shippedSensor("crap"), display: "crap", description: "x", runsTests: true, metrics: shippedSensor("crap").metrics.slice(0, 1) }])};

const tick = () => new Promise((resolve) => setTimeout(resolve, 60));
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const host = document.getElementById("content");
const q = (selector) => host.querySelector(selector);
const qa = (selector) => [...host.querySelectorAll(selector)];

const idle = () => ({ running: false, runState: { running: [], started: null, failures: {}, diagnoses: {}, ranAt: {} }, progressText: null, sensorProgress: null, extracting: false, describe: null });
let st = idle();
const scanState = () => ({ origin: { branch: "main", commit: "abc1234" }, scannedAt: Date.now(), changes: { files: [{ path: "app/b.py", kind: "modified" }], moved: null }, scanning: st.progressText });
const scanHost = scanHostOf({
  port: fakeSensors({}, {}, {}, SHIPPED),
  scan: scanState,
  runState: () => st.runState,
  running: () => st.running,
  progressText: () => st.progressText,
  sensorProgress: () => st.sensorProgress,
  extracting: () => st.extracting,
  describeProgress: () => st.describe,
});

async function openEverything() {
  click(q('.tree .row[data-path="app"] .name'));
  await tick();
  for (const id of ids) {
    click(q('.tree .row[data-path="' + id + '"] .reye'));
    await tick();
  }
  click(q(".metrics-toggle"));
  await tick();
  click(q('.metric-row[data-metric="crap/complexity"]'));
  await tick();
}

const steps = [
  ["idle", () => idle()],
  ["extracting", () => ({ ...idle(), running: true, extracting: true, progressText: "Extracting" })],
  ["sensor running", () => ({ ...idle(), running: true, progressText: "crap", runState: { running: ["crap"], started: "crap", failures: {}, diagnoses: {}, ranAt: {} }, sensorProgress: { name: "crap", phase: "sense", progress: { done: 1, total: 4, unit: "functions" } } })],
  ["sensor advancing", () => ({ ...idle(), running: true, progressText: "crap", runState: { running: ["crap"], started: "crap", failures: {}, diagnoses: {}, ranAt: {} }, sensorProgress: { name: "crap", phase: "sense", progress: { done: 3, total: 4, unit: "functions" } } })],
  ["describing", () => ({ ...idle(), running: true, progressText: "Describing", describe: { entries: 1, total: 2 } })],
  ["failing", () => ({ ...idle(), runState: { running: [], started: null, failures: { crap: "broke" }, diagnoses: {}, ranAt: {} } })],
  ["settled", () => idle()],
];

const markOf = () => qa(".findings-line, .findings-fresh-text").map((n) => n.textContent).join("|");
const notesOf = () => qa(".metric-note").map((n) => n.textContent).join("|");
const changedOf = () => qa(".changed-label").length + "|" + qa(".disc-fill.grey").length;

(async () => {
  const facts = {};
  const explorer = mountExplorer({ container: host, loaded, title: "demo", post: () => null, carried: null, scanHost });
  await tick();
  await openEverything();

  explorer.refreshPanel();
  const right = host.innerHTML;
  explorer.update(loaded);
  facts.afterFull = right === host.innerHTML;

  facts.equivalence = [];
  facts.marks = {};
  facts.notes = {};
  facts.changed = {};
  for (const [name, make] of steps) {
    st = make();
    explorer.refreshPanel();
    const narrow = host.innerHTML;
    facts.marks[name] = markOf();
    facts.notes[name] = notesOf();
    explorer.update(loaded);
    facts.equivalence.push({ name, same: narrow === host.innerHTML });
  }

  for (const name of ["extracting", "settled"]) {
    st = steps.find(([label]) => label === name)[1]();
    explorer.refreshPanel();
    await tick();
    facts.changed[name] = changedOf();
  }

  st = { ...idle(), running: true, progressText: "one" };
  explorer.refreshPanel();
  const watched = { tree: ".tree .rows", notes: ".notes-panel", views: ".views-panel", canvas: ".stage", scan: ".scan-panel", rail: ".rail" };
  const counts = {};
  const observers = Object.entries(watched).map(([key, selector]) => {
    counts[key] = 0;
    const observer = new MutationObserver((records) => { counts[key] += records.length; });
    observer.observe(q(selector), { subtree: true, childList: true, attributes: true, characterData: true });
    return observer;
  });
  st = { ...st, progressText: "two" };
  explorer.refreshPanel();
  await tick();
  for (const observer of observers) observer.disconnect();
  facts.mutations = counts;

  const ageOf = () => q(".metric-group-age").textContent;
  const stageMutations = { count: 0 };
  const stageObserver = new MutationObserver((records) => { stageMutations.count += records.length; });
  stageObserver.observe(q(".stage"), { subtree: true, childList: true, attributes: true, characterData: true });
  facts.ageBefore = ageOf();
  skew = 3 * 60000;
  for (const run of ageTicks) run();
  await tick();
  stageObserver.disconnect();
  facts.ageAfter = ageOf();
  facts.ageStageMutations = stageMutations.count;
  facts.ageTickers = ageTicks.length;

  ${
    MEASURE
      ? `
  const many = Array.from({ length: 3000 }, (_, i) => "pkg" + (i % 60) + "/m" + i + ".py");
  const bigScan = { ...scan, files: many.map((path) => ({ path, hash: ${JSON.stringify(H1)} })), modules: many.map((id) => ({ id, kind: "module", members })) };
  explorer.dispose();
  host.replaceChildren();
  const bigLoaded = loadedOf({ modules: many, scans: [{ file: "scan.json", scan: bigScan }], sensors: [] });
  const big = mountExplorer({ container: host, loaded: bigLoaded, title: "big", post: () => null, carried: null, scanHost });
  await tick();
  const times = [];
  for (let i = 0; i < 30; i++) {
    st = { ...idle(), running: true, progressText: "tick " + i };
    const start = performance.now();
    big.refreshPanel();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  facts.median = times[15];
`
      : ""
  }
  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Facts = ReturnType<typeof JSON.parse>;

describe.skipIf(webkit === undefined)(
  "progress updates re-render only what they change",
  () => {
    let f = null as unknown as Facts;

    beforeAll(async () => {
      f = await collectFacts<Facts>(HARNESS, "explorer-progress-look");
    }, scaledTimeout(180000));

    it("draws what a full render draws right after a full render", () => {
      expect(f.afterFull).toBe(true);
    });

    it("draws what a full render draws after every scripted progress step", () => {
      for (const step of f.equivalence) {
        expect(step, step.name).toEqual({ name: step.name, same: true });
      }
    });

    it("leaves the tree, notes panel, views panel and canvas untouched when only the Scan panel text changes", () => {
      expect(f.mutations.tree).toBe(0);
      expect(f.mutations.notes).toBe(0);
      expect(f.mutations.views).toBe(0);
      expect(f.mutations.canvas).toBe(0);
      expect(f.mutations.scan).toBeGreaterThan(0);
    });

    it("touches the rail when only the Scan panel text changes", () => {
      expect(f.mutations.rail).toBeGreaterThan(0);
    });

    it("advances the canvas metric header age on the minute tick during a scan without redrawing the canvas", () => {
      expect(f.ageTickers).toBe(1);
      expect(f.ageBefore).not.toBe("");
      expect(f.ageAfter).not.toBe(f.ageBefore);
      expect(f.ageAfter).toBe("measured 3 minutes ago");
      expect(f.ageStageMutations).toBe(0);
    });

    it("moves the Findings line when the structure row flips from extracting to settled", () => {
      expect(f.marks.extracting).not.toBe(f.marks.settled);
    });

    it("moves the canvas changed boxes when the structure row flips from extracting to settled", () => {
      expect(f.changed.extracting).not.toBe(f.changed.settled);
    });

    it("moves the canvas metric note when a sensor's done count advances", () => {
      expect(f.notes["sensor running"]).not.toBe(f.notes["sensor advancing"]);
    });

    it.runIf(MEASURE)("measures refreshPanel on 3000 modules", () => {
      process.stdout.write(`progress-median-ms ${f.median}\n`);
      expect(f.median).toBeGreaterThan(0);
    });
  },
);
