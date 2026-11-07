import { beforeAll, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../scripts/pool-scale.mjs";
import { collectFacts, FAKE_WORKER, here, webkit } from "./look-page";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const H1 = "1".repeat(64);
const H2 = "2".repeat(64);
const H0 = "0".repeat(64);
const TESTS = "a".repeat(64);
const OTHER_TESTS = "b".repeat(64);

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { loadedOf, mountExplorer, scanHostOf } from ${JSON.stringify(here("look-support.ts"))};
import { fakeSensors } from ${JSON.stringify(here("sensors-fake.ts"))};
${FAKE_WORKER}

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
const inputs = { "app/a.py": ${JSON.stringify(H1)}, "app/b.py": ${JSON.stringify(H0)} };
const overlay = JSON.stringify({ overlay_version: 2, commit: ${JSON.stringify(COMMIT)}, modified: false, inputs, tests: ${JSON.stringify(TESTS)}, producer: { name: "crap", version: "0.1.0" }, metrics: [{ name: "complexity", type: "count", granularity: "member", bad: "high" }], values: { complexity: { "app/a.py::f": 8, "app/b.py::f": 5 } } });
const finding = (id, module) => ({ id, kind: "style", severity: "warning", principle: "name-your-constants", summary: "magic numbers " + id, evidence: { modules: [module] } });
const document_ = { findings_version: 2, sensor: { name: "crap", version: "0.1.0" }, commit: ${JSON.stringify(COMMIT)}, modified: false, settings: {}, inputs, tests: ${JSON.stringify(TESTS)}, findings: [finding("on-a", "app/a.py"), finding("on-b", "app/b.py")] };
const loadedFor = (tests) => loadedOf({ modules: ids, scans: [{ file: "scan.json", scan }], overlays: [{ name: "crap", text: overlay }], findings: [document_], sensors: [{ name: "crap", status: "ran", measured: { inputs, tests: ${JSON.stringify(TESTS)} } }], tests });

const SHIPPED = [{ name: "crap", display: "crap", line: "x", defaults: {}, runsTests: true, listed: true, metrics: [{ name: "complexity", type: "count", granularity: "member", bad: "high" }] }];
const port = () => fakeSensors({}, {}, {}, SHIPPED);

const tick = () => new Promise((resolve) => setTimeout(resolve, 60));
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const host = document.getElementById("content");
const q = (selector) => host.querySelector(selector);
const qa = (selector) => [...host.querySelectorAll(selector)];
const facts = {};

const barsOf = (id) => qa('.box[data-id="' + id + '"] .metric-bar').length;
const discOf = (id) => q('.box[data-id="' + id + '"] .disc-fill').getAttribute("class");
const tablesFor = async (id) => {
  click(q('.box[data-id="' + id + '"] .box-body'));
  await tick();
  if (!q(".inspector-panel .pswitch")) {
    click(q('.selection-bar [aria-label^="Contents"]'));
    await tick();
  }
  await tick();
  return qa(".inspector-panel .fn-metrics").map((row) => [...row.querySelectorAll(".fn-metric")].map((item) => item.firstChild.textContent + " " + item.querySelector("b").textContent));
};

const changedScan = () => ({ origin: { branch: "main", commit: "abc1234" }, scannedAt: Date.now(), changes: { files: [{ path: "app/b.py", kind: "modified" }], moved: null }, scanning: null });

async function observe(tests, changed = false) {
  host.replaceChildren();
  const scanHost = changed ? scanHostOf({ scan: changedScan, port: port() }) : scanHostOf({ port: port() });
  const explorer = mountExplorer({ container: host, loaded: loadedFor(tests), title: "demo", post: () => null, carried: null, scanHost });
  await tick();
  click(q('.tree .row[data-path="app"] .name'));
  await tick();
  for (const id of ids) {
    click(q('.tree .row[data-path="' + id + '"] .reye'));
    await tick();
  }
  click(q(".metrics-toggle"));
  await tick();
  const row = q('.metric-row[data-metric="crap/complexity"]');
  const rowDisabled = row.classList.contains("disabled");
  click(row);
  await tick();
  const boxHeight = (id) => Number(q('.box[data-id="' + id + '"] .box-body').getAttribute("height"));
  const seen = {
    rowDisabled,
    heightA: boxHeight("app/a.py"),
    heightB: boxHeight("app/b.py"),
    labelA: q('.box[data-id="app/a.py"] .changed-label') === null ? null : q('.box[data-id="app/a.py"] .changed-label').textContent,
    labelB: q('.box[data-id="app/b.py"] .changed-label') === null ? null : q('.box[data-id="app/b.py"] .changed-label').textContent,
    nameRightB: q('.box[data-id="app/b.py"] .name').getBBox().x + q('.box[data-id="app/b.py"] .name').getBBox().width,
    labelLeftB: q('.box[data-id="app/b.py"] .changed-label') === null ? null : q('.box[data-id="app/b.py"] .changed-label').getBBox().x,
    note: qa(".metric-note").map((note) => note.textContent),
    barsA: barsOf("app/a.py"),
    barsB: barsOf("app/b.py"),
    discA: discOf("app/a.py"),
    discB: discOf("app/b.py"),
  };
  seen.tablesA = await tablesFor("app/a.py");
  seen.tablesB = await tablesFor("app/b.py");

  click(q(".rail-findings"));
  await tick();
  const line = q(".findings-line");
  seen.line = line === null ? null : line.textContent;
  const stale = q(".findings-fresh-text");
  seen.staleLine = stale === null ? null : stale.textContent;
  explorer.dispose();
  return seen;
}

(async () => {
  facts.matching = await observe(${JSON.stringify(TESTS)});
  facts.changedTests = await observe(${JSON.stringify(OTHER_TESTS)});
  facts.changedModule = await observe(${JSON.stringify(TESTS)}, true);
  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Facts = ReturnType<typeof JSON.parse>;

describe.skipIf(webkit === undefined)(
  "the four surfaces agree on which modules are current",
  () => {
    let f = null as unknown as Facts;

    beforeAll(async () => {
      f = await collectFacts<Facts>(HARNESS, "freshness-look");
    }, scaledTimeout(180000));

    it("shows only the edited-free module on the canvas, the Contents tab, the Findings panel and the disc", () => {
      expect(f.matching.rowDisabled).toBe(false);
      expect(f.matching.note).toEqual([
        "crap: 1 module out of date. Run crap from the Scan panel.",
      ]);
      expect(f.matching.barsA).toBe(1);
      expect(f.matching.barsB).toBe(0);
      expect(f.matching.tablesA).toEqual([["cc 8", "CRAP -", "cov -"]]);
      expect(f.matching.tablesB).toEqual([["cc -", "CRAP -", "cov -"]]);
      expect(f.matching.line).toBe("1 warning");
      expect(f.matching.staleLine).toBe(
        "Findings for 1 changed module is hidden.",
      );
      expect(f.matching.discA).toContain("amber");
      expect(f.matching.discB).toContain("grey");
    });

    it("shows nothing once the tests hash differs", () => {
      expect(f.changedTests.rowDisabled).toBe(true);
      expect(f.changedTests.note).toEqual([
        "crap: 2 modules out of date. Run crap from the Scan panel.",
      ]);
      expect(f.changedTests.barsA).toBe(0);
      expect(f.changedTests.barsB).toBe(0);
      expect(f.changedTests.tablesA).toEqual([]);
      expect(f.changedTests.line).toBe("");
      expect(f.changedTests.discA).toContain("grey");
    });

    it("draws a changed module's box with no bars, a grey disc and a quiet changed label, no taller than a box with one bar row", () => {
      expect(f.changedModule.labelB).toBe("changed");
      expect(f.changedModule.labelA).toBeNull();
      expect(f.changedModule.barsB).toBe(0);
      expect(f.changedModule.discB).toContain("grey");
      expect(f.changedModule.heightB).toBeLessThanOrEqual(
        f.changedModule.heightA,
      );
      expect(f.matching.labelB).toBeNull();
    });

    it("keeps the changed label clear of a short module name", () => {
      expect(f.changedModule.labelLeftB).not.toBeNull();
      expect(f.changedModule.labelLeftB).toBeGreaterThan(
        f.changedModule.nameRightB,
      );
    });
  },
);
