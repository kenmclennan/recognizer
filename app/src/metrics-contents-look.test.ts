import { beforeAll, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../scripts/pool-scale.mjs";
import { collectFacts, FAKE_WORKER, here, webkit } from "./look-page";

const SCAN_COMMIT = "0123456789abcdef0123456789abcdef01234567";
const OTHER_COMMIT = "ffffffffffffffffffffffffffffffffffffffff";

const overlayAt = (commit: string) =>
  JSON.stringify({
    overlay_version: 1,
    commit,
    modified: false,
    producer: { name: "crap", version: "0.1.0" },
    metrics: [
      { name: "complexity", type: "count", granularity: "member", bad: "high" },
      { name: "coverage", type: "ratio", granularity: "member", bad: "low" },
    ],
    values: {
      complexity: {
        "app/risk.py::classify": 8,
        "app/risk.py::Runner.run": 3,
      },
      coverage: {
        "app/risk.py::classify": 0.5,
        "app/risk.py::Runner.run": 0.9,
      },
    },
  });

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { loadedOf, mountExplorer } from ${JSON.stringify(here("look-support.ts"))};
${FAKE_WORKER}

const members = [
  { name: "classify", kind: "function", exported: true, line: 1, params: [], returns: "int" },
  { name: "unmeasured", kind: "function", exported: true, line: 5, params: [], returns: "int" },
  { name: "Runner", kind: "class", exported: true, line: 9, bases: [], fields: [],
    methods: [
      { name: "run", line: 10, params: [] },
      { name: "idle", line: 14, params: [] },
    ] },
];
const scan = {
  commit: ${JSON.stringify(SCAN_COMMIT)},
  modified: false,
  modules: [{ id: "app/risk.py", kind: "module", members }],
  edges: [],
  foreign: [],
};
const loadedFor = (overlay) => loadedOf({ modules: ["app/risk.py"], scans: [{ file: "scan.json", scan }], overlays: [{ name: "crap", text: overlay }] });

const tick = () => new Promise((resolve) => setTimeout(resolve, 60));
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const host = document.getElementById("content");
const q = (selector) => host.querySelector(selector);
const qa = (selector) => [...host.querySelectorAll(selector)];
const footer = { text: null };
const facts = {};

const mount = (overlay, carried) => mountExplorer({ container: host, loaded: loadedFor(overlay), title: "demo", post: () => null, carried, showMetrics: (text) => { footer.text = text; } });
const bars = () => qa('.box[data-id="app/risk.py"] .metric-bar').map((bar) => ({ metric: bar.dataset.metric, value: bar.querySelector(".metric-value").textContent }));
const functionRows = () => qa(".inspector-panel .fn-metrics").map((row) => [...row.querySelectorAll(".fn-metric")].map((item) => item.firstChild.textContent + " " + item.querySelector("b").textContent));
const tables = () => qa(".inspector-panel .card-metrics").map((table) => ({
  head: [...table.querySelectorAll(".metrics-head th")].map((cell) => cell.textContent),
  rows: [...table.querySelectorAll(".metrics-row")].map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent)),
}));

async function look() {
  if (!q('.box[data-id="app/risk.py"]')) {
    if (!q('.tree .row[data-path="app/risk.py"]')) {
      click(q('.tree .row[data-path="app"] .name'));
      await tick();
    }
    click(q('.tree .row[data-path="app/risk.py"] .rcheck'));
    await tick();
  }
  click(q('.box[data-id="app/risk.py"] .box-body'));
  await tick();
  if (!q(".inspector-panel .pswitch")) {
    click(q('.selection-bar [aria-label^="Contents"]'));
    await tick();
  }
}

(async () => {
  let explorer = mount(${JSON.stringify(overlayAt(SCAN_COMMIT))}, null);
  await tick();
  await look();
  click(q(".metrics-toggle"));
  await tick();
  click(q('.metric-row[data-metric="crap/complexity"]'));
  await tick();
  click(q('.metric-row[data-metric="crap/coverage"]'));
  await tick();
  facts.currentBars = bars();
  facts.currentTables = tables();
  facts.currentFunctions = functionRows();
  facts.currentFooter = footer.text;

  const carried = explorer.carry();
  explorer.dispose();
  host.replaceChildren();
  explorer = mount(${JSON.stringify(overlayAt(OTHER_COMMIT))}, carried);
  await tick();
  await look();
  click(q(".metrics-toggle"));
  await tick();
  facts.staleBars = bars();
  facts.staleTables = tables();
  facts.staleFunctions = functionRows();
  facts.staleFooter = footer.text;
  facts.staleRows = qa(".metric-row").map((row) => ({ key: row.dataset.metric, disabled: row.classList.contains("disabled") }));
  facts.staleNotes = qa(".metric-note").map((note) => note.textContent);
  click(q('.metric-row[data-metric="crap/complexity"]'));
  await tick();
  facts.staleBarsAfterClick = bars();

  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Facts = ReturnType<typeof JSON.parse>;

describe.skipIf(webkit === undefined)(
  "metric bars and the Contents table agree",
  () => {
    let f = null as unknown as Facts;

    beforeAll(async () => {
      f = await collectFacts<Facts>(HARNESS, "metrics-contents-look");
    }, scaledTimeout(180000));

    it("shows each member's values in the table with a dash for an unmeasured one while the overlay is current", () => {
      expect(f.currentBars).toEqual([
        { metric: "crap/complexity", value: "8" },
        { metric: "crap/coverage", value: "50%" },
      ]);
      expect(f.currentFunctions).toEqual([
        ["cc 8", "CRAP -", "cov 50%"],
        ["cc -", "CRAP -", "cov -"],
      ]);
      expect(f.currentTables).toHaveLength(1);
      expect(f.currentTables[0].head).toEqual(["", "cc", "cov"]);
      expect(f.currentTables[0].rows).toEqual([
        ["run", "3", "90%"],
        ["idle", "-", "-"],
      ]);
    });

    it("draws no bar and no table, lists the metrics disabled and ignores a click once the overlay is out of date", () => {
      expect(f.staleBars).toEqual([]);
      expect(f.staleTables).toEqual([]);
      expect(f.staleFunctions).toEqual([]);
      expect(f.staleFooter).toBeNull();
      expect(f.staleRows).toEqual([
        { key: "crap/complexity", disabled: true },
        { key: "crap/coverage", disabled: true },
      ]);
      expect(f.staleNotes[0]).toContain("Out of date");
      expect(f.staleBarsAfterClick).toEqual([]);
    });
  },
);
