import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../../tools/scripts/pool-scale.mjs";
import type { Program } from "../../../cli/test/support/index";
import { collectFacts, FAKE_WORKER, here, webkit } from "../../src/look-page";
import { untilHolds } from "../app-harness";
import { appSensor } from "../in-process-root";
import {
  digestOf,
  Gate,
  heldProgram,
  type LookScenario,
  type LookStage,
  lookRoots,
  scanProgram,
} from "../look-root";

type Root = Parameters<LookStage["run"]>[0];

const installed = JSON.parse(
  readFileSync(
    here("../../../schema/overlay-examples/valid/crap.json"),
    "utf8",
  ),
);
const DAY = 86400000;
const REPORTED = "2026-03-01T12:00:00.000Z";
const STALE_COMMIT = "f".repeat(40);

const branches = (from: number, count: number) =>
  Array.from(
    { length: count },
    (_, index) =>
      `    elif x == ${from + index}:\n        return ${from + index}\n`,
  ).join("");
const RISK_TEXT = `def classify(x):\n    if x == 0:\n        return 0\n${branches(1, 6)}    return -1\n`;
const HEAVY_LINE = RISK_TEXT.split("\n").length + 2;
const MIXED_TEXT = `${RISK_TEXT}\n\ndef heavy(x):\n    if x == 0:\n        return 0\n${branches(1, 11)}    return -1\n`;
const OTHER_TEXT = "def pick():\n    return 1\n";
const NONE_TEXT = "NAME = 1\n";

const IDS = ["app/risk.py", "src/other.py", "lib/none.py"];
const hashes = (risk: string) => ({
  [IDS[0] as string]: digestOf(risk),
  [IDS[1] as string]: digestOf(OTHER_TEXT),
  [IDS[2] as string]: digestOf(NONE_TEXT),
});
const EDITED = Object.fromEntries(IDS.map((id) => [id, "0".repeat(64)]));

const member = (name: string, line: number) => ({
  name,
  kind: "function",
  exported: true,
  line,
  params: [],
  returns: "int",
});
const scanOf = (risk: string, riskMembers: ReturnType<typeof member>[]) => ({
  files: IDS.map((path) => ({ path, hash: hashes(risk)[path] })),
  modules: [
    { id: IDS[0], kind: "module", members: riskMembers },
    { id: IDS[1], kind: "module", members: [member("pick", 1)] },
    { id: IDS[2], kind: "module", members: [] },
  ],
  edges: [{ from: IDS[0], to: IDS[1], kind: "depends", line: 1, names: ["X"] }],
  foreign: [],
});
const SCAN = scanOf(RISK_TEXT, [member("classify", 1)]);
const MIXED_SCAN = scanOf(MIXED_TEXT, [
  member("classify", 1),
  member("heavy", HEAVY_LINE),
]);

const crapOverlay =
  (
    values: Record<string, Record<string, number>>,
    inputs: Record<string, string>,
    stale = false,
    extra: Record<string, unknown>[] = [],
  ) =>
  (commit: string) =>
    JSON.stringify({
      ...installed,
      commit: stale ? STALE_COMMIT : commit,
      inputs,
      producer: { name: "crap", version: "0.1.72" },
      metrics: [...installed.metrics, ...extra],
      values,
    });
const RISK_VALUES = {
  complexity: { "app/risk.py::classify": 8 },
  coverage: { "app/risk.py::classify": 0.1818 },
  crap: { "app/risk.py::classify": 40 },
};
const MIXED_VALUES = {
  complexity: { "app/risk.py::classify": 8, "app/risk.py::heavy": 12 },
  coverage: { "app/risk.py::classify": 0.1, "app/risk.py::heavy": 0.5 },
  crap: { "app/risk.py::classify": 40, "app/risk.py::heavy": 30 },
};
const LONG_VALUES = {
  ...RISK_VALUES,
  "a-very-long-metric": { "app/risk.py::classify": 3 },
};
const mutationOverlay = (inputs: Record<string, string>) => (commit: string) =>
  JSON.stringify({
    overlay_version: 1,
    inputs,
    commit,
    modified: false,
    producer: { name: "mutation", version: "0.1.0" },
    metrics: ["killed", "survived", "uncovered", "score"].map((name) => ({
      name,
      type: "count",
      granularity: "member",
      bad: name === "killed" || name === "score" ? "low" : "high",
    })),
    values: {
      killed: { "app/risk.py::classify": 2 },
      survived: { "app/risk.py::classify": 3 },
      uncovered: {},
      score: {},
    },
  });
const findingsOf =
  (
    name: string,
    inputs: Record<string, string>,
    stale = false,
    extra: Record<string, unknown> = {},
  ) =>
  (commit: string) =>
    JSON.stringify({
      findings_version: 2,
      sensor: { name, version: "0.1.72" },
      commit: stale ? STALE_COMMIT : commit,
      modified: false,
      settings: {},
      inputs,
      findings: [],
      reported_at: REPORTED,
      ...extra,
    });

const overlayFile = (name: string) => `.recognizer/cache/overlays/${name}.json`;
const findingsFile = (name: string) =>
  `.recognizer/cache/findings/${name}.json`;
const CURRENT = hashes(RISK_TEXT);
const MIXED = hashes(MIXED_TEXT);

const crapFiles = (
  values: Record<string, Record<string, number>>,
  inputs: Record<string, string>,
  stale = false,
  extra: Record<string, unknown>[] = [],
) => ({
  [overlayFile("crap")]: crapOverlay(values, inputs, stale, extra),
  [findingsFile("crap")]: findingsOf("crap", inputs, stale),
});
const mutationFiles = (measured: number) => ({
  [overlayFile("mutation")]: mutationOverlay(CURRENT),
  [findingsFile("mutation")]: findingsOf("mutation", CURRENT, false, {
    stopped: { measured, total: 1545 },
    partial: { measured, total: 1545 },
  }),
});

const withCrapMetric =
  (program: Program): Program =>
  (call) => {
    const result = program(call);

    if (call.args[0] !== "manifest") {
      return result;
    }

    const manifest = JSON.parse((result as { stdout: string }).stdout);

    manifest.metrics.push({
      name: "a-very-long-metric",
      type: "count",
      granularity: "member",
      bad: "high",
    });

    return { ...(result as object), stdout: JSON.stringify(manifest) } as never;
  };

const SENSORS =
  "sensors:\n  crap:\n    manifest: [recognizer-sense-crap, manifest]\n  mutation:\n    manifest: [recognizer-sense-mutation, manifest]\n";

const made = (
  files: LookScenario["files"] = {},
  rest: Partial<LookScenario> = {},
  risk = RISK_TEXT,
  scan: Record<string, unknown> = SCAN,
): LookScenario => ({
  files: {
    "app/risk.py": risk,
    "src/other.py": OTHER_TEXT,
    "lib/none.py": NONE_TEXT,
    ...files,
  },
  programs: {
    "recognizer-scan-typescript": scanProgram(scan, ["python"]),
    ...rest.programs,
  },
  ...Object.fromEntries(
    Object.entries(rest).filter(([key]) => key !== "programs"),
  ),
});

const pluginsOf = (root: Root): { name: string; state: string }[] => {
  const states = (root.lines as Record<string, unknown>[]).filter(
    (line) => typeof line.state === "object" && line.state !== null,
  );
  const run = (
    states[states.length - 1]?.state as
      | { run?: { plugins?: { name: string; state: string }[] } | null }
      | undefined
  )?.run;

  return run?.plugins ?? [];
};

const untilCrapRunning = async (root: Root) => {
  const host = await untilHolds(root.service, () => root.view.explorer()?.host);

  host.run(null);

  for (let round = 0; round < 600; round += 1) {
    if (
      pluginsOf(root).some(
        (one) => one.name === "crap" && one.state === "running",
      )
    ) {
      return;
    }

    await root.service.signal(1000);
  }

  throw new Error("crap never reached running");
};

const crapGate = new Gate();

const SCENARIOS = (): Record<string, LookScenario> => {
  crapGate.hold();

  return {
    current: made(crapFiles(RISK_VALUES, CURRENT)),
    stale: made(crapFiles(RISK_VALUES, EDITED, true)),
    partial: made(mutationFiles(245)),
    stoppedNothing: made(mutationFiles(0)),
    neverRun: made(
      {},
      {
        config: `sensors:\n  structure: off\n${SENSORS.replace("sensors:\n", "")}`,
      },
    ),
    running: made(crapFiles(RISK_VALUES, CURRENT), {
      ticks: { describe: false, analysis: false, ticked: ["crap"] },
      programs: {
        "recognizer-sense-crap": heldProgram(
          appSensor("crap", false, false, () => ""),
          crapGate,
        ),
      },
      stages: [
        { name: "idle", run: async () => {} },
        { name: "running", run: untilCrapRunning },
      ],
    }),
    long: made(
      crapFiles(LONG_VALUES, CURRENT, false, [
        {
          name: "a-very-long-metric",
          type: "count",
          granularity: "member",
          bad: "high",
        },
      ]),
      {
        programs: {
          "recognizer-sense-crap": withCrapMetric(
            appSensor("crap", false, false, () => ""),
          ),
        },
      },
    ),
    mixed: made(crapFiles(MIXED_VALUES, MIXED), {}, MIXED_TEXT, MIXED_SCAN),
  };
};

const AGES = {
  partial: 5 * 60000,
  stoppedNothing: 5 * 60000,
};

const HARNESS = (recordings: unknown) => `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { drawRecording } from ${JSON.stringify(here("../test/look-draw.ts"))};
import { pageAnswers } from ${JSON.stringify(here("../test/look-answers.ts"))};
${FAKE_WORKER}

const recordings = ${JSON.stringify(recordings)};
const AGES = ${JSON.stringify(AGES)};
const REPORTED = ${JSON.stringify(REPORTED)};
const DAY = ${DAY};
const clock = { offset: 0 };
const realNow = Date.now.bind(Date);
Date.now = () => realNow() + clock.offset;

const tick = () => new Promise((resolve) => setTimeout(resolve, 60));
const click = (node) => { if (!node) throw new Error("click on nothing"); return node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); };
const host = document.getElementById("content");
const footerElement = document.getElementById("footer");
const q = (selector) => host.querySelector(selector);
const qa = (selector) => [...host.querySelectorAll(selector)];
const facts = {};
const commitOf = (name) => recordings[name].loaded.scans[0].document.commit;

async function draw(name, options = {}) {
  host.replaceChildren();
  footerElement.replaceChildren();
  clock.offset = Date.parse(REPORTED) + (AGES[name] ?? 2 * DAY) - realNow();
  const recording = recordings[name];
  const drawn = await drawRecording(host, recording, {
    answer: pageAnswers(recording, options.page ?? {}),
    ...(options.until === undefined ? {} : { until: options.until }),
    ...(options.carried === undefined ? {} : { carried: options.carried }),
  });
  await tick();
  return drawn;
}

async function expandAll() {
  for (const folder of ["app", "src", "lib"]) {
    click(q('.tree .row[data-path="' + folder + '"] .reye'));
    await tick();
  }
}

const boxOf = (id) => q('.box[data-id="' + id + '"]');
const discs = () => qa(".box .disc-fill").map((d) => d.getAttribute("class"));
const heightOf = (id) => Number(boxOf(id).querySelector(".box-body").getAttribute("height"));
const shapeOf = (id) => {
  const body = boxOf(id).querySelector(".box-body");
  const mark = boxOf(id).querySelector(".note-mark");
  return {
    x: Number(body.getAttribute("x")),
    y: Number(body.getAttribute("y")),
    width: Number(body.getAttribute("width")),
    height: Number(body.getAttribute("height")),
    nameY: Number(boxOf(id).querySelector(".name").getAttribute("y")),
    discY: Number(boxOf(id).querySelector(".disc-fill").getAttribute("cy")),
    bars: boxOf(id).querySelectorAll(".metric-bar").length,
    unknown: boxOf(id).querySelectorAll(".metric-track.unknown").length,
    dashes: [...boxOf(id).querySelectorAll("text")].filter((t) => t.textContent === "-").length,
    mark: mark ? { x: Number(mark.firstElementChild.getAttribute("x")), y: Number(mark.firstElementChild.getAttribute("y")), size: Number(mark.firstElementChild.getAttribute("height")) } : null,
  };
};
const barsOf = (id) => [...boxOf(id).querySelectorAll(".metric-bar")].map((bar) => ({
  metric: bar.dataset.metric,
  title: bar.querySelector("title").textContent,
  track: bar.querySelector(".metric-track").getAttribute("class"),
  trackX: Number(bar.querySelector(".metric-track").getAttribute("x")),
  trackY: Number(bar.querySelector(".metric-track").getAttribute("y")),
  valueX: Number(bar.querySelector(".metric-value").getAttribute("x")),
  label: bar.querySelector(".metric-label").textContent,
  labelX: Number(bar.querySelector(".metric-label").getAttribute("x")),
  labelRight: bar.querySelector(".metric-label").getBBox().x + bar.querySelector(".metric-label").getBBox().width,
  trackWidth: Number(bar.querySelector(".metric-track").getAttribute("width")),
  fill: bar.querySelector(".metric-fill") ? bar.querySelector(".metric-fill").getAttribute("class") : null,
  fillWidth: bar.querySelector(".metric-fill") ? Number(bar.querySelector(".metric-fill").getAttribute("width")) : null,
  value: bar.querySelector(".metric-value").textContent,
  anchor: bar.querySelector(".metric-value").getAttribute("text-anchor"),
}));

const stateOf = async (name, until) => {
  await draw(name, until === undefined ? {} : { until });
  await expandAll();
  click(q(".metrics-toggle"));
  await tick();
  const groups = qa(".canvas-metrics h4");
  const before = qa(".metric-bar").length;
  click(q('.metric-row[data-metric="mutation/survived"]') ?? q(".metric-row"));
  await tick();
  return {
    headers: groups.map((g) => ({ title: g.querySelector(".metric-group-title").textContent, age: g.querySelector(".metric-group-age").textContent, tooltip: g.title })),
    notes: qa(".metric-note").map((n) => ({ text: n.textContent, cls: n.className })),
    rows: qa(".metric-row").map((r) => ({ key: r.dataset.metric, text: r.textContent, disabled: r.classList.contains("disabled"), aria: r.querySelector("[aria-disabled]") !== null })),
    chips: qa(".metric-chip").length,
    perMember: q(".canvas-metrics").textContent.includes("per member"),
    clickAdded: qa(".metric-bar").length - before,
  };
};

const sourcesOf = async (name, keys) => {
  await draw(name);
  await expandAll();
  click(q(".metrics-toggle"));
  await tick();
  for (const key of keys) {
    click(q('.metric-row[data-metric="' + key + '"]'));
    await tick();
  }
  const line = boxOf("app/risk.py").querySelector(".metric-sources");
  const body = boxOf("app/risk.py").querySelector(".box-body");
  const bars = [...boxOf("app/risk.py").querySelectorAll(".metric-track")].map((t) => Number(t.getAttribute("y")) + Number(t.getAttribute("height")));
  const icon = line ? line.querySelector("svg") : null;
  const text = line ? line.querySelector(".metric-sources-text") : null;
  return {
    present: line !== null,
    text: text ? text.textContent : null,
    title: line ? line.querySelector("title").textContent : null,
    iconSize: icon ? [Number(icon.getAttribute("width")), Number(icon.getAttribute("height"))] : null,
    textY: text ? Number(text.getAttribute("y")) : null,
    lastBarBottom: Math.max(...bars),
    boxBottom: Number(body.getAttribute("y")) + Number(body.getAttribute("height")),
  };
};

(async () => {
  let drawn = await draw("current");
  await expandAll();

  facts.controls = qa(".controls .control").map((b) => b.textContent);
  facts.discsBefore = discs();
  if (facts.discsBefore.length === 0) throw new Error("no discs drawn at the first read");
  facts.heightBefore = heightOf("app/risk.py");

  click(q(".metrics-toggle"));
  await tick();
  facts.heading = q(".canvas-metrics h4 .metric-group-title").textContent;
  facts.rows = qa(".metric-row").map((r) => ({ key: r.dataset.metric, text: r.textContent })).filter((r) => ["structure/complexity", "crap/coverage", "crap/crap"].includes(r.key));

  click(q('.metric-row[data-metric="structure/complexity"]'));
  await tick();
  click(q('.metric-row[data-metric="crap/coverage"]'));
  await tick();
  facts.detailCount = qa(".metric-row .metric-detail").length;
  facts.rowCount = qa(".metric-row").length;
  facts.heightTwo = heightOf("app/risk.py");
  facts.risk = barsOf("app/risk.py");
  facts.other = barsOf("src/other.py");
  facts.none = barsOf("lib/none.py");
  facts.oneShape = shapeOf("src/other.py");
  facts.twoShape = shapeOf("app/risk.py");
  facts.noneShape = shapeOf("lib/none.py");
  facts.plainName = facts.noneShape.nameY;
  click(q('.metric-row[data-metric="crap/crap"]'));
  await tick();
  facts.threeShape = shapeOf("app/risk.py");
  facts.threeBars = barsOf("app/risk.py");
  click(q('.metric-row[data-metric="crap/crap"]'));
  await tick();
  facts.discsAfter = discs();
  facts.notePosition = Number(boxOf("app/risk.py").querySelector(".metric-bar rect").getAttribute("y"));
  facts.boxY = Number(boxOf("app/risk.py").querySelector(".box-body").getAttribute("y"));

  const carried = drawn.explorer().carry();
  facts.carriedTicks = carried;
  drawn = await draw("current", { carried });
  facts.afterRebuild = { bars: barsOf("app/risk.py").length };

  click(q(".metrics-toggle"));
  await tick();
  click(q('.metric-row[data-metric="crap/coverage"]'));
  await tick();
  facts.afterUntick = { bars: barsOf("app/risk.py").length, height: heightOf("app/risk.py") };

  click(q('.metric-row[data-metric="crap/coverage"]'));
  await tick();
  click(q('.metric-row[data-metric="structure/complexity"]'));
  await tick();
  const staleCarried = drawn.explorer().carry();
  drawn = await draw("stale", { carried: staleCarried });
  facts.afterStale = { bars: barsOf("app/risk.py").length };
  click(q(".metrics-toggle"));
  await tick();
  facts.afterStaleGroup = {
    header: q(".canvas-metrics h4").textContent,
    notes: qa(".metric-note").map((n) => ({ text: n.textContent, cls: n.className })),
    disabled: qa('.metric-row.disabled[data-metric^="crap/"]').length,
    chips: qa(".metric-chip").length,
    perMember: q(".canvas-metrics").textContent.includes("per member"),
  };
  click(q('.metric-row[data-metric="crap/coverage"]'));
  await tick();
  facts.staleClick = barsOf("app/risk.py").length;

  facts.scanCommit = commitOf("current").slice(0, 7);
  facts.currentState = await stateOf("current");
  facts.outOfDateState = await stateOf("stale");
  facts.partialState = await stateOf("partial");
  facts.stoppedNothingState = await stateOf("stoppedNothing");
  facts.neverRunState = await stateOf("neverRun");
  facts.runningState = await stateOf("running", "running");

  await draw("neverRun");
  click(q(".metrics-toggle"));
  await tick();
  facts.empty = q(".canvas-metrics").textContent;

  await draw("long");
  await expandAll();
  click(q(".metrics-toggle"));
  await tick();
  click(q('.metric-row[data-metric="crap/a-very-long-metric"]'));
  await tick();
  facts.long = barsOf("app/risk.py");

  facts.mixed = await sourcesOf("mixed", ["structure/complexity", "crap/coverage"]);
  facts.single = await sourcesOf("current", ["structure/complexity", "crap/coverage"]);

  const viewFile = JSON.stringify({
    schema_version: 4,
    description: "d",
    commit: commitOf("current"),
    notes: [
      { module: "app/risk.py", text: "Risk note", by: "Ken" },
      { module: "lib/none.py", text: "None note", by: "Ken" },
    ],
    steps: [{ kind: "pick", module: "app/risk.py" }, { kind: "pick", module: "lib/none.py" }],
  }) + "\\n";
  await draw("current", { page: { views: [{ name: "order", text: viewFile }] }, carried: facts.carriedTicks });
  click(q(".view-list"));
  click(qa(".view-item")[0]);
  await tick();
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  await tick();
  facts.markShapes = { risk: shapeOf("app/risk.py"), none: shapeOf("lib/none.py") };

  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Facts = ReturnType<typeof JSON.parse>;

describe.skipIf(webkit === undefined)("metric bars on the canvas", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    try {
      const named = await lookRoots(SCENARIOS());
      const recordings = Object.fromEntries(
        Object.entries(named).map(([name, { produced: _, ...one }]) => [
          name,
          one,
        ]),
      );

      f = await collectFacts<Facts>(HARNESS(recordings), "metrics-look");
    } finally {
      crapGate.open();
    }
  }, scaledTimeout(300000));

  it("puts Metrics before Legend and lists the metrics under the overlay's heading", () => {
    expect(f.controls.slice(-2)).toEqual(["Metrics", "Legend"]);
    expect(f.heading).toBe("Structural analysis");
    expect(f.rows.map((r: { key: string }) => r.key)).toEqual([
      "structure/complexity",
      "crap/coverage",
      "crap/crap",
    ]);
    expect(f.rows[0].text).toContain("Cyclomatic complexity of each function.");
    expect(f.rows[0].text).not.toContain("per member");
  });

  it("renders no metric-detail line for a ticked metric", () => {
    expect(f.rowCount).toBeGreaterThan(0);
    expect(f.risk).toHaveLength(2);
    expect(f.detailCount).toBe(0);
  });

  it("draws a row per measured metric in tick order and grows the box by each row plus 6px", () => {
    expect(f.heightBefore).toBe(40);
    expect(f.heightTwo).toBe(40 + 2 * 14 + 6);
    expect(f.risk.map((b: { metric: string }) => b.metric)).toEqual([
      "structure/complexity",
      "crap/coverage",
    ]);
  });

  it("colours and sizes the bars by the worst member and titles them", () => {
    const [complexity, coverage] = f.risk;

    expect(complexity.fill).toBe("metric-fill red");
    expect(complexity.fillWidth).toBe(complexity.trackWidth);
    expect(complexity.value).toBe("8");
    expect(complexity.title).toBe("Complexity 8, worst: classify");
    expect(complexity.anchor).toBe("end");
    expect(coverage.fill).toBe("metric-fill red");
    expect(coverage.fillWidth).toBeCloseTo(coverage.trackWidth * 0.1818, 5);
    expect(coverage.value).toBe("18%");
    expect(coverage.title).toBe("Coverage 18%, worst: classify");
    expect(f.other[0].fill).toBe("metric-fill green");
    expect(f.other[0].value).toBe("1");
    expect(f.other[0].title).toBe("Complexity 1, worst: pick");
  });

  it("draws no element for a metric a file has no value for", () => {
    expect(f.none).toEqual([]);
    expect(f.other.length).toBe(1);
    expect(f.noneShape.bars).toBe(0);
    expect(f.noneShape.height).toBe(40);

    for (const shape of [f.oneShape, f.twoShape, f.threeShape, f.noneShape]) {
      expect(shape.unknown).toBe(0);
      expect(shape.dashes).toBe(0);
    }
  });

  it("gives boxes in one view different heights by their own measured rows", () => {
    expect(f.oneShape.height).toBe(40 + 14 + 6);
    expect(f.twoShape.height).toBe(40 + 2 * 14 + 6);
    expect(f.threeShape.height).toBe(40 + 3 * 14 + 6);
    expect(f.noneShape.height).toBe(40);
  });

  it("keeps the name row where a plain box has it, whatever the rows", () => {
    const plainOffset = f.noneShape.nameY - f.noneShape.y;

    for (const shape of [f.oneShape, f.twoShape, f.threeShape]) {
      expect(shape.nameY - shape.y).toBe(plainOffset);
      expect(shape.discY - shape.y).toBe(20);
    }
  });

  it("lays each row out from the mock: label, track and right-aligned figure", () => {
    const shape = f.threeShape;

    f.threeBars.forEach(
      (
        bar: {
          trackX: number;
          trackY: number;
          valueX: number;
          labelX: number;
          anchor: string;
          label: string;
        },
        index: number,
      ) => {
        expect(bar.trackY).toBe(shape.y + 40 + index * 14 + 4);
        expect(bar.trackX).toBe(shape.x + 44);
        expect(bar.valueX).toBe(shape.x + shape.width - 10);
        expect(bar.labelX).toBe(shape.x + 12);
        expect(bar.anchor).toBe("end");
        expect(bar.label.length).toBeGreaterThan(0);
      },
    );
    expect(f.twoShape.width).toBeGreaterThanOrEqual(150);
    expect(f.oneShape.width).toBeGreaterThanOrEqual(150);
    expect(f.noneShape.width).toBeLessThan(150);
  });

  it("clips a label with no short name so it ends before the track", () => {
    const [bar] = f.long;

    expect(bar.label).toBe("a-v…");
    expect(bar.title).toBe("a-very-long-metric 3, worst: classify");
    expect(bar.labelRight).toBeLessThanOrEqual(bar.trackX);
  });

  it("says when the bars come from more than one function, below the last bar and inside the box", () => {
    expect(f.mixed.present).toBe(true);
    expect(f.mixed.text).toBe("from 2 functions");
    expect(f.mixed.title).toBe("cc: heavy\ncov: classify");
    expect(f.mixed.iconSize).toEqual([13, 13]);
    expect(f.mixed.textY).toBe(f.mixed.lastBarBottom + 14 + 6);
    expect(f.mixed.textY).toBeLessThanOrEqual(f.mixed.boxBottom);
  });

  it("shows no such line when every bar comes from one function", () => {
    expect(f.single.present).toBe(false);
  });

  it("leaves the discs unchanged", () => {
    expect(f.discsAfter).toEqual(f.discsBefore);
  });

  it("keeps the note mark on the name row whatever the rows", () => {
    for (const shape of [f.markShapes.risk, f.markShapes.none]) {
      expect(shape.mark).not.toBeNull();
      expect(shape.mark.x).toBe(shape.x + shape.width - 22);
      expect(shape.mark.y + shape.mark.size / 2).toBe(shape.y + 20);
    }
    expect(f.markShapes.risk.height).toBe(40 + 2 * 14 + 6);
    expect(f.markShapes.none.height).toBe(40);
  });

  it("keeps the ticks across a rebuild and drops one when unticked", () => {
    expect(f.afterRebuild.bars).toBe(2);
    expect(f.afterUntick.bars).toBe(1);
    expect(f.afterUntick.height).toBe(40 + 14 + 6);
  });

  it("says no overlays were found when there are none", () => {
    expect(f.empty).toContain("Structural analysis");
    expect(f.empty).toContain("Never run");
  });

  it("shows a current group with its age, no note and tickable rows", () => {
    const state = f.currentState;

    const crap = state.headers.find(
      (h: { title: string }) => h.title === "C.R.A.P.",
    );

    expect(crap.age).toBe("measured 2 days ago");
    expect(crap.tooltip).toContain(`crap 0.1.72 - at ${f.scanCommit}`);
    expect(
      state.notes.filter((n: { text: string }) =>
        n.text.startsWith("Out of date"),
      ),
    ).toEqual([]);
    const rows = state.rows.filter((r: { key: string }) =>
      r.key.startsWith("crap/"),
    );

    expect(rows.map((r: { text: string }) => r.text)).toEqual([
      expect.stringContaining("Coverage"),
      expect.stringContaining("C.R.A.P."),
    ]);
    expect(rows[0].disabled).toBe(false);
    expect(state.perMember).toBe(false);
    expect(state.chips).toBe(0);
  });

  it("says a running sensor is running, muted, with no call to action", () => {
    const crap = f.runningState.notes.filter((n: { text: string }) =>
      n.text.startsWith("Running"),
    );

    expect(crap).toEqual([{ text: "Running", cls: "metric-note muted" }]);
  });

  it("warns amber on an out-of-date group and lists its rows disabled", () => {
    const state = f.outOfDateState;

    const crap = state.headers.find(
      (h: { title: string }) => h.title === "C.R.A.P.",
    );

    expect(crap.title).toBe("C.R.A.P.");
    expect(state.notes).toContainEqual({
      text: "3 files out of date. Run C.R.A.P. from the Scan panel.",
      cls: "metric-note warn",
    });
    expect(
      state.rows.find((r: { key: string }) => r.key === "crap/coverage")
        .disabled,
    ).toBe(true);
    expect(crap.tooltip).toContain("crap 0.1.72 - at fffffff");
    expect(state.perMember).toBe(false);
    expect(state.chips).toBe(0);
    expect(f.afterStaleGroup.notes[0].cls).toBe("metric-note warn");
    expect(f.afterStale).toEqual({ bars: 0 });
    expect(f.staleClick).toBe(0);
    expect(f.afterStaleGroup.disabled).toBe(2);
    expect(f.afterStaleGroup.chips).toBe(0);
  });

  it("says partial in amber for a stopped run that kept functions", () => {
    const state = f.partialState;
    const mutation = state.headers.find(
      (h: { title: string }) => h.title === "Mutation",
    );

    expect(mutation.age).toBe("stopped 5 minutes ago");
    expect(state.notes).toContainEqual({
      text: "Partial: 245 of 1,545 functions measured. The rest are uncoloured.",
      cls: "metric-note warn",
    });
    expect(state.clickAdded).toBe(1);
    expect(state.perMember).toBe(false);
    expect(state.chips).toBe(0);
  });

  it("disables a group stopped with nothing and explains it in muted text", () => {
    const state = f.stoppedNothingState;
    const mutationRows = state.rows.filter((r: { key: string }) =>
      r.key.startsWith("mutation/"),
    );

    expect(state.notes).toContainEqual({
      text: "Stopped before any function finished, so there is nothing to show.",
      cls: "metric-note muted",
    });
    expect(mutationRows).toHaveLength(4);
    expect(
      mutationRows.every(
        (r: { disabled: boolean; aria: boolean }) => r.disabled && r.aria,
      ),
    ).toBe(true);
    expect(state.clickAdded).toBe(0);
    expect(state.perMember).toBe(false);
  });

  it("shows a sensor that never ran as disabled with a muted note", () => {
    const state = f.neverRunState;

    expect(state.headers.map((h: { title: string }) => h.title)).toEqual([
      "Structural analysis",
      "C.R.A.P.",
      "Mutation",
    ]);
    expect(state.headers.every((h: { age: string }) => h.age === "")).toBe(
      true,
    );
    expect(state.notes.map((n: { text: string }) => n.text)).toEqual([
      "Never run. Run Structural analysis from the Scan panel.",
      "Never run. Run C.R.A.P. from the Scan panel.",
      "Never run. Run Mutation from the Scan panel.",
    ]);
    expect(
      state.notes.every((n: { cls: string }) => n.cls === "metric-note muted"),
    ).toBe(true);
    expect(state.rows.every((r: { disabled: boolean }) => r.disabled)).toBe(
      true,
    );
    expect(state.clickAdded).toBe(0);
    expect(state.chips).toBe(0);
  });
});
