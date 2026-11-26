import { beforeAll, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../../tools/scripts/pool-scale.mjs";
import type { Program } from "../../../cli/test/support/index";
import { collectFacts, FAKE_WORKER, here, webkit } from "../../src/look-page";
import { appSensor } from "../in-process-root";
import { digestOf, lookRoots, scanProgram } from "../look-root";

const SCAN_COMMIT = "0123456789abcdef0123456789abcdef01234567";

const RISK_TEXT = `def classify(x):
    if x == 1:
        return 1
    elif x == 2:
        return 2
    elif x == 3:
        return 3
    elif x == 4:
        return 4
    elif x == 5:
        return 5
    elif x == 6:
        return 6
    elif x == 7:
        return 7
    return 0


def unmeasured():
    return 1


class Runner:
    def run(self, a):
        if a:
            return 1
        elif a == 2:
            return 2
        return 0

    def idle(self):
        return 1
`;
const EDITED_TEXT = `${RISK_TEXT}\n\ndef added():\n    return 2\n`;
const HASH = digestOf(RISK_TEXT);
const EDITED = digestOf(EDITED_TEXT);

const overlayAt = (commit: string, hash = HASH) =>
  JSON.stringify({
    overlay_version: 1,
    commit,
    inputs: { "app/risk.py": hash },
    modified: false,
    producer: { name: "crap", version: "0.1.0" },
    metrics: [
      { name: "coverage", type: "ratio", granularity: "member", bad: "low" },
    ],
    values: {
      coverage: {
        "app/risk.py::classify": 0.5,
        "app/risk.py::Runner.run": 0.9,
      },
    },
  });

const members = [
  {
    name: "classify",
    kind: "function",
    exported: true,
    line: 1,
    params: [],
    returns: "int",
  },
  {
    name: "unmeasured",
    kind: "function",
    exported: true,
    line: 5,
    params: [],
    returns: "int",
  },
  {
    name: "Runner",
    kind: "class",
    exported: true,
    line: 9,
    bases: [],
    fields: [],
    methods: [
      { name: "run", line: 10, params: [], private: false },
      { name: "idle", line: 14, params: [], private: false },
    ],
  },
];
const scan = {
  commit: SCAN_COMMIT,
  modified: false,
  files: [{ path: "app/risk.py", hash: HASH }],
  modules: [{ id: "app/risk.py", kind: "module", members }],
  edges: [],
  foreign: [],
};
const CONFIG =
  "sensors:\n  crap:\n    manifest: [recognizer-sense-crap, manifest]\n";

const crap: Program = (call) => {
  const result = appSensor("crap", false, false, () => HASH)(call);

  if (call.args[0] !== "manifest") {
    return result;
  }

  const manifest = JSON.parse((result as { stdout: string }).stdout);

  manifest.display = "crap";
  manifest.description = "x";

  return { ...(result as object), stdout: JSON.stringify(manifest) } as never;
};

const findingsAt = (commit: string, hash: string) =>
  JSON.stringify({
    findings_version: 2,
    sensor: { name: "crap", version: "0.1.0" },
    commit,
    modified: false,
    settings: {},
    inputs: { "app/risk.py": hash },
    findings: [],
  });

const scenario = (
  overlay: (commit: string) => string,
  findings: (commit: string) => string,
) => ({
  config: CONFIG,
  files: {
    "app/risk.py": RISK_TEXT,
    ".recognizer/cache/overlays/crap.json": overlay,
    ".recognizer/cache/findings/crap.json": findings,
  },
  programs: {
    "recognizer-scan-typescript": scanProgram(scan, ["python"]),
    "recognizer-sense-crap": crap,
  },
});

const HARNESS = (recordings: unknown) => `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { drawRecording } from ${JSON.stringify(here("../test/look-draw.ts"))};
${FAKE_WORKER}

const recordings = ${JSON.stringify(recordings)};

const tick = () => new Promise((resolve) => setTimeout(resolve, 60));
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const host = document.getElementById("content");
const q = (selector) => host.querySelector(selector);
const qa = (selector) => [...host.querySelectorAll(selector)];
const facts = {};

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
    click(q('.tree .row[data-path="app/risk.py"] .reye'));
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
  let drawn = await drawRecording(host, recordings.current);
  await tick();
  await look();
  click(q(".metrics-toggle"));
  await tick();
  click(q('.metric-row[data-metric="structure/complexity"]'));
  await tick();
  click(q('.metric-row[data-metric="crap/coverage"]'));
  await tick();
  facts.currentBars = bars();
  facts.currentTables = tables();
  facts.currentFunctions = functionRows();
  facts.currentFooter = document.getElementById("module-count").textContent;

  const carried = drawn.explorer().carry();
  drawn.dispose();
  host.replaceChildren();
  drawn = await drawRecording(host, recordings.stale, { carried });
  await tick();
  await look();
  click(q(".metrics-toggle"));
  await tick();
  facts.staleBars = bars();
  facts.staleTables = tables();
  facts.staleFunctions = functionRows();
  facts.staleFooter = document.getElementById("module-count").textContent;
  facts.staleRows = qa(".metric-row").map((row) => ({ key: row.dataset.metric, disabled: row.classList.contains("disabled") }));
  facts.staleNotes = qa(".metric-note").map((note) => note.textContent);
  click(q('.metric-row[data-metric="structure/complexity"]'));
  await tick();
  facts.staleBarsAfterClick = bars();

  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Facts = ReturnType<typeof JSON.parse>;
const distinct = (rows: string[][]) => rows.map((row) => [...new Set(row)]);
const columnsOf = (
  tables: { head: string[]; rows: string[][] }[],
  names: string[],
) =>
  tables.map((table) => {
    const at = names
      .map((name) => table.head.indexOf(name))
      .filter((index) => index >= 0);

    return {
      head: at.map((index) => table.head[index]),
      rows: table.rows.map((row) => at.map((index) => row[index])),
    };
  });

describe.skipIf(webkit === undefined)(
  "metric bars and the Contents table agree",
  () => {
    let f = null as unknown as Facts;

    beforeAll(async () => {
      const named = await lookRoots({
        current: scenario(
          (commit) => overlayAt(commit),
          (commit) => findingsAt(commit, HASH),
        ),
        stale: scenario(
          (commit) => overlayAt(commit, EDITED),
          (commit) => findingsAt(commit, EDITED),
        ),
      });
      const recordings = Object.fromEntries(
        Object.entries(named).map(([name, { produced: _, ...one }]) => [
          name,
          one,
        ]),
      );

      f = await collectFacts<Facts>(
        HARNESS(recordings),
        "metrics-contents-look",
      );
    }, scaledTimeout(180000));

    it("shows each member's values in the table with a dash for an unmeasured one while the overlay is current", () => {
      expect(f.currentBars).toEqual([
        { metric: "structure/complexity", value: "8" },
        { metric: "crap/coverage", value: "50%" },
      ]);
      expect(distinct(f.currentFunctions)).toEqual([
        ["cc 8", "CRAP -", "cov 50%"],
        ["cc 1", "CRAP -", "cov -"],
      ]);
      expect(columnsOf(f.currentTables, ["", "cc", "cov"])).toEqual([
        {
          head: ["", "cc", "cov"],
          rows: [
            ["run", "3", "90%"],
            ["idle", "1", "-"],
          ],
        },
      ]);
    });

    it("draws no bar and no table, lists the metrics disabled and ignores a click once the overlay is out of date", () => {
      expect(f.staleBars).toEqual([
        { metric: "structure/complexity", value: "8" },
      ]);
      expect(columnsOf(f.staleTables, ["", "cc", "cov"])).toEqual([
        {
          head: ["", "cc"],
          rows: [
            ["run", "3"],
            ["idle", "1"],
          ],
        },
      ]);
      expect(distinct(f.staleFunctions)).toEqual([
        ["cc 8", "CRAP -", "cov -"],
        ["cc 1", "CRAP -", "cov -"],
      ]);
      expect(f.staleFooter).toBe("1 of 1 files on the canvas");
      expect(
        f.staleRows.filter(
          (row: { key: string }) =>
            row.key === "structure/complexity" || row.key === "crap/coverage",
        ),
      ).toEqual([
        { key: "structure/complexity", disabled: false },
        { key: "crap/coverage", disabled: true },
      ]);
      expect(f.staleNotes).toContain(
        "1 file out of date. Run crap from the Scan panel.",
      );
      expect(f.staleBarsAfterClick).toEqual([]);
    });
  },
);
