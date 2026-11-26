import { beforeAll, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../../tools/scripts/pool-scale.mjs";
import type { Program } from "../../../cli/test/support/index";
import { collectFacts, FAKE_WORKER, here, webkit } from "../../src/look-page";
import { appSensor } from "../in-process-root";
import { digestOf, lookRoots, scanProgram, testsDigestOf } from "../look-root";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const A_TEXT = "def f():\n    return 1\n";
const B_TEXT = "def f():\n    return 2\n";
const H1 = digestOf(A_TEXT);
const H2 = digestOf(B_TEXT);
const H0 = "0".repeat(64);
const TEST_FILE = "api/tests/a.test.ts";
const TESTS = testsDigestOf({ [TEST_FILE]: "export const t = 1;\n" });

const members = [
  {
    name: "f",
    kind: "function",
    exported: true,
    line: 1,
    params: [],
    returns: "int",
  },
];
const IDS = ["app/a.py", "app/b.py"];
const scan = {
  commit: COMMIT,
  modified: false,
  files: [
    { path: "app/a.py", hash: H1 },
    { path: "app/b.py", hash: H2 },
  ],
  modules: IDS.map((id) => ({ id, kind: "module", members })),
  edges: [
    {
      from: "app/a.py",
      to: "app/b.py",
      kind: "depends",
      line: 1,
      names: ["f"],
    },
  ],
  foreign: [],
};
const inputs = { "app/a.py": H1, "app/b.py": H0 };
const overlay = (commit: string) =>
  JSON.stringify({
    overlay_version: 2,
    commit,
    modified: false,
    inputs,
    tests: TESTS,
    producer: { name: "crap", version: "0.1.0" },
    metrics: [
      { name: "coverage", type: "count", granularity: "member", bad: "high" },
    ],
    values: { coverage: { "app/a.py::f": 8, "app/b.py::f": 5 } },
  });
const finding = (id: string, module: string) => ({
  id,
  kind: "style",
  severity: "warning",
  principle: "name-your-constants",
  summary: `magic numbers ${id}`,
  evidence: { modules: [module] },
});
const findingsDocument = (commit: string) =>
  JSON.stringify({
    findings_version: 2,
    sensor: { name: "crap", version: "0.1.0" },
    commit,
    modified: false,
    settings: {},
    inputs,
    tests: TESTS,
    findings: [finding("on-a", "app/a.py"), finding("on-b", "app/b.py")],
  });
const CONFIG =
  "sensors:\n  crap:\n    manifest: [recognizer-sense-crap, manifest]\n";

const crap: Program = (call) => {
  const result = appSensor("crap", true, false, () => H1)(call);

  if (call.args[0] !== "manifest") {
    return result;
  }

  const manifest = JSON.parse((result as { stdout: string }).stdout);

  manifest.display = "crap";
  manifest.description = "x";
  manifest.metrics = manifest.metrics.slice(0, 1);

  return { ...(result as object), stdout: JSON.stringify(manifest) } as never;
};

const scenario = (testText: string, extra: Record<string, unknown> = {}) => ({
  config: CONFIG,
  files: {
    ".recognizer/policy.yaml": "entry: [app/a.py]\n",
    ".recognizer/cache/overlays/crap.json": overlay,
    ".recognizer/cache/findings/crap.json": findingsDocument,
    [TEST_FILE]: testText,
    "app/a.py": A_TEXT,
    "app/b.py": B_TEXT,
  },
  programs: {
    "recognizer-scan-typescript": scanProgram(scan),
    "recognizer-sense-crap": crap,
  },
  ...extra,
});

const HARNESS = (recordings: unknown) => `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { drawRecording } from ${JSON.stringify(here("../test/look-draw.ts"))};
${FAKE_WORKER}

const recordings = ${JSON.stringify(recordings)};
const ids = ["app/a.py", "app/b.py"];

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

async function observe(name) {
  host.replaceChildren();
  const drawn = await drawRecording(host, recordings[name]);
  await tick();
  click(q('.tree .row[data-path="app"] .name'));
  await tick();
  for (const id of ids) {
    click(q('.tree .row[data-path="' + id + '"] .reye'));
    await tick();
  }
  click(q(".metrics-toggle"));
  await tick();
  const row = q('.metric-row[data-metric="crap/coverage"]');
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
    note: qa(".metric-note").map((note) => note.textContent).filter((text) => !text.includes("Structural analysis")),
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
  drawn.dispose();
  return seen;
}

(async () => {
  facts.matching = await observe("matching");
  facts.changedTests = await observe("changedTests");
  facts.changedModule = await observe("changedModule");
  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Facts = ReturnType<typeof JSON.parse>;
const complexityOf = (tables: string[][]) =>
  tables
    .map((row) => [...new Set(row.filter((item) => item.startsWith("cc")))])
    .filter((row) => row.length > 0);

describe.skipIf(webkit === undefined)(
  "the four surfaces agree on which files are current",
  () => {
    let f = null as unknown as Facts;

    beforeAll(async () => {
      const named = await lookRoots({
        matching: scenario("export const t = 1;\n"),
        changedTests: scenario("export const t = 2;\n"),
        changedModule: scenario("export const t = 1;\n", {
          origin: { branch: "main", commit: "abc1234" },
          hostEvents: [
            {
              event: "changes-changed",
              payload: {
                files: [{ path: "app/b.py", kind: "modified" }],
                moved: null,
              },
            },
          ],
        }),
      });
      const recordings = Object.fromEntries(
        Object.entries(named).map(([name, { produced: _, ...one }]) => [
          name,
          one,
        ]),
      );

      f = await collectFacts<Facts>(HARNESS(recordings), "freshness-look");
    }, scaledTimeout(180000));

    it("shows only the edited-free file on the canvas, the Contents tab, the Findings panel and the disc", () => {
      expect(f.matching.rowDisabled).toBe(false);
      expect(f.matching.note).toContain(
        "1 file out of date. Run crap from the Scan panel.",
      );
      expect(f.matching.barsA).toBe(1);
      expect(f.matching.barsB).toBe(0);
      expect(complexityOf(f.matching.tablesA)).toEqual([["cc -"]]);
      expect(complexityOf(f.matching.tablesB)).toEqual([["cc -"]]);
      expect(f.matching.line).toBe("1 warning");
      expect(f.matching.staleLine).toBe(
        "Findings for 1 changed file is hidden.",
      );
      expect(f.matching.discA).toContain("amber");
      expect(f.matching.discB).toContain("green");
    });

    it("shows nothing once the tests hash differs", () => {
      expect(f.changedTests.rowDisabled).toBe(true);
      expect(f.changedTests.note).toContain(
        "2 files out of date. Run crap from the Scan panel.",
      );
      expect(f.changedTests.barsA).toBe(0);
      expect(f.changedTests.barsB).toBe(0);
      expect(f.changedTests.tablesA).toEqual([]);
      expect(f.changedTests.line).toBe("");
      expect(f.changedTests.discA).toContain("green");
    });

    it("draws a changed file's box with no bars, a grey disc and a quiet changed label, no taller than a box with one bar row", () => {
      expect(f.changedModule.labelB).toBe("changed");
      expect(f.changedModule.labelA).toBeNull();
      expect(f.changedModule.barsB).toBe(0);
      expect(f.changedModule.discB).toContain("grey");
      expect(f.changedModule.heightB).toBeLessThanOrEqual(
        f.changedModule.heightA,
      );
      expect(f.matching.labelB).toBeNull();
    });

    it("keeps the changed label clear of a short file name", () => {
      expect(f.changedModule.labelLeftB).not.toBeNull();
      expect(f.changedModule.labelLeftB).toBeGreaterThan(
        f.changedModule.nameRightB,
      );
    });
  },
);
