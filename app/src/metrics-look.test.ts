import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../scripts/pool-scale.mjs";
import { collectFacts, FAKE_WORKER, here, webkit } from "./look-page";
import { shippedSensors } from "./shipped-fake";

const SCAN_COMMIT = "0123456789abcdef0123456789abcdef01234567";

const shipped = JSON.parse(
  readFileSync(here("../../schema/overlay-examples/valid/crap.json"), "utf8"),
);
const HASH = "1".repeat(64);
const EDITED = "0".repeat(64);
const inputsAt = (hash: string) => ({
  "app/risk.py": hash,
  "src/other.ts": hash,
  "lib/none.py": hash,
});
const fresh = JSON.stringify({
  ...shipped,
  commit: SCAN_COMMIT,
  inputs: inputsAt(HASH),
});
const stale = JSON.stringify({
  ...shipped,
  commit: "ffffffffffffffffffffffffffffffffffffffff",
  inputs: inputsAt(EDITED),
});

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { loadedOf, mountExplorer, scanHostOf } from ${JSON.stringify(here("look-support.ts"))};
import { fakeSensors } from ${JSON.stringify(here("sensors-fake.ts"))};
import { fakeViews } from ${JSON.stringify(here("views-fake.ts"))};
${FAKE_WORKER}

const ids = ["app/risk.py", "src/other.ts", "lib/none.py"];
const HASH = ${JSON.stringify(HASH)};
const INPUTS = ${JSON.stringify(inputsAt(HASH))};
const scanOf = () => ({
  commit: ${JSON.stringify(SCAN_COMMIT)},
  modified: false,
  files: ids.map((id) => ({ path: id, hash: HASH })),
  modules: ids.map((id) => ({ id, kind: "module" })),
  edges: [{ from: ids[0], to: ids[1], kind: "depends", line: 1, names: ["X"] }],
  foreign: [],
});
const loadedFor = (overlay) => loadedOf({
  modules: ids,
  scans: [{ file: "scan.json", scan: scanOf() }],
  overlays: overlay === null ? [] : [{ name: "crap", text: overlay }],
  sensors: overlay === null ? [] : [{ name: "crap", status: "ran", measured: { inputs: JSON.parse(overlay).inputs } }],
});

const SHIPPED = ${JSON.stringify(
  shippedSensors()
    .filter((sensor) => sensor.metrics.length > 0)
    .map((sensor) => ({ ...sensor, findings: [] })),
)};
const DAY = 86400000;
const crapOverlay = (commit, inputs = INPUTS) => JSON.stringify({ overlay_version: 1, commit, inputs, modified: false, producer: { name: "crap", version: "0.1.72" }, metrics: [{ name: "complexity", type: "count", granularity: "member", bad: "high" }, { name: "coverage", type: "ratio", granularity: "member", bad: "low" }, { name: "crap", type: "number", granularity: "member", bad: "high" }], values: { complexity: { "app/risk.py::classify": 8 }, coverage: { "app/risk.py::classify": 0.18 }, crap: { "app/risk.py::classify": 40 } } });
const mutationOverlay = () => JSON.stringify({ overlay_version: 1, inputs: INPUTS, commit: ${JSON.stringify(SCAN_COMMIT)}, modified: false, producer: { name: "mutation", version: "0.1.0" }, metrics: ["killed", "survived", "uncovered", "score"].map((name) => ({ name, type: "count", granularity: "member", bad: name === "killed" || name === "score" ? "low" : "high" })), values: { killed: { "app/risk.py::classify": 2 }, survived: { "app/risk.py::classify": 3 }, uncovered: {}, score: {} } });
const status = (name, over) => ({ name, status: "ran", commit: ${JSON.stringify(SCAN_COMMIT)}, findings: 0, measured: { inputs: INPUTS }, ...over });

const tick = () => new Promise((resolve) => setTimeout(resolve, 60));
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const host = document.getElementById("content");
const q = (selector) => host.querySelector(selector);
const qa = (selector) => [...host.querySelectorAll(selector)];
const port = fakeViews({});
const facts = {};

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

(async () => {
  const crapHost = () => scanHostOf({ port: fakeSensors({}, {}, {}, SHIPPED.filter((one) => one.name === "crap").map((one) => ({ ...one, display: "crap" }))) });
  const mount = (overlay, carried) => mountExplorer({ container: host, loaded: loadedFor(overlay), title: "demo", views: port, post: () => null, carried, scanHost: scanHostOf({ port: fakeSensors({}, {}, {}, overlay === null ? [] : SHIPPED.filter((one) => one.name === "crap").map((one) => ({ ...one, display: "crap" }))) }) });
  let explorer = mount(${JSON.stringify(fresh)}, null);
  await tick();
  for (const folder of ["app", "src", "lib"]) {
    click(q('.tree .row[data-path="' + folder + '"] .reye'));
    await tick();
  }

  facts.controls = qa(".controls .control").map((b) => b.textContent);
  facts.discsBefore = discs();
  facts.heightBefore = heightOf("app/risk.py");

  click(q(".metrics-toggle"));
  await tick();
  facts.heading = q(".canvas-metrics h4 .metric-group-title").textContent;
  facts.rows = qa(".metric-row").map((r) => ({ key: r.dataset.metric, text: r.textContent }));

  click(q('.metric-row[data-metric="crap/complexity"]'));
  await tick();
  click(q('.metric-row[data-metric="crap/coverage"]'));
  await tick();
  facts.detail = qa(".metric-row .metric-detail").map((d) => d.textContent);
  facts.heightTwo = heightOf("app/risk.py");
  facts.risk = barsOf("app/risk.py");
  facts.other = barsOf("src/other.ts");
  facts.none = barsOf("lib/none.py");
  facts.oneShape = shapeOf("src/other.ts");
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

  const carried = explorer.carry();
  facts.carriedTicks = carried;
  explorer.dispose();
  host.replaceChildren();
  explorer = mount(${JSON.stringify(fresh)}, carried);
  await tick();
  facts.afterRebuild = { bars: barsOf("app/risk.py").length };

  click(q(".metrics-toggle"));
  await tick();
  click(q('.metric-row[data-metric="crap/coverage"]'));
  await tick();
  facts.afterUntick = { bars: barsOf("app/risk.py").length, height: heightOf("app/risk.py") };

  const staleCarried = explorer.carry();
  explorer.dispose();
  host.replaceChildren();
  explorer = mount(${JSON.stringify(stale)}, staleCarried);
  await tick();
  facts.afterStale = { bars: barsOf("app/risk.py").length };
  click(q(".metrics-toggle"));
  await tick();
  facts.afterStaleGroup = {
    header: q(".canvas-metrics h4").textContent,
    notes: qa(".metric-note").map((n) => ({ text: n.textContent, cls: n.className })),
    disabled: qa(".metric-row.disabled").length,
    chips: qa(".metric-chip").length,
    perMember: q(".canvas-metrics").textContent.includes("per member"),
  };
  click(q('.metric-row[data-metric="crap/complexity"]'));
  await tick();
  facts.staleClick = barsOf("app/risk.py").length;

  const stateOf = async (overlays, sensors, shippedList = SHIPPED, hostOver = {}) => {
    explorer.dispose();
    host.replaceChildren();
    explorer = mountExplorer({ container: host, loaded: loadedOf({ modules: ids, scans: [{ file: "scan.json", scan: scanOf() }], overlays, sensors }), title: "demo", views: port, post: () => null, carried: null, scanHost: scanHostOf({ port: fakeSensors({}, {}, {}, shippedList), ...hostOver }) });
    await tick();
    for (const folder of ["app", "src", "lib"]) {
      click(q('.tree .row[data-path="' + folder + '"] .reye'));
      await tick();
    }
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
  facts.currentState = await stateOf([{ name: "crap", text: crapOverlay(${JSON.stringify(SCAN_COMMIT)}), modifiedMs: Date.now() - 2 * DAY }], [status("crap")]);
  facts.outOfDateState = await stateOf([{ name: "crap", text: crapOverlay("ffffffffffffffffffffffffffffffffffffffff", ${JSON.stringify(inputsAt(EDITED))}), modifiedMs: Date.now() - 2 * DAY }], [status("crap", { commit: "ffffffffffffffffffffffffffffffffffffffff", measured: { inputs: ${JSON.stringify(inputsAt(EDITED))} } })]);
  facts.partialState = await stateOf([{ name: "mutation", text: mutationOverlay(), modifiedMs: Date.now() - 5 * 60000 }], [status("mutation", { stopped: { measured: 245, total: 1545 }, partial: { measured: 245, total: 1545 } })]);
  facts.stoppedNothingState = await stateOf([{ name: "mutation", text: mutationOverlay(), modifiedMs: Date.now() - 5 * 60000 }], [status("mutation", { stopped: { measured: 0, total: 1545 }, partial: { measured: 0, total: 1545 } })]);
  facts.neverRunState = await stateOf([], []);
  facts.runningState = await stateOf([{ name: "crap", text: crapOverlay(${JSON.stringify(SCAN_COMMIT)}), modifiedMs: Date.now() - 2 * DAY }], [status("crap")], SHIPPED, { running: () => true, runState: () => ({ running: ["crap"], started: Date.now(), failures: {}, diagnoses: {}, ranAt: {} }) });

  explorer.dispose();
  host.replaceChildren();
  explorer = mount(null, null);
  await tick();
  click(q(".metrics-toggle"));
  await tick();
  facts.empty = q(".canvas-metrics").textContent;

  explorer.dispose();
  host.replaceChildren();
  const longOverlay = JSON.stringify({
    overlay_version: 1,
    inputs: INPUTS,
    commit: ${JSON.stringify(SCAN_COMMIT)},
    modified: false,
    producer: { name: "long", version: "0.1.0" },
    metrics: [{ name: "a-very-long-metric", type: "count", granularity: "member", bad: "high" }],
    values: { "a-very-long-metric": { "app/risk.py::classify": 3 } },
  });
  explorer = mountExplorer({ container: host, loaded: loadedOf({ modules: ids, scans: [{ file: "scan.json", scan: scanOf() }], overlays: [{ name: "crap", text: longOverlay }], sensors: [status("crap")] }), title: "demo", views: port, post: () => null, carried: null, scanHost: crapHost() });
  await tick();
  for (const folder of ["app", "src", "lib"]) {
    click(q('.tree .row[data-path="' + folder + '"] .reye'));
    await tick();
  }
  click(q(".metrics-toggle"));
  await tick();
  click(q('.metric-row[data-metric="crap/a-very-long-metric"]'));
  await tick();
  facts.long = barsOf("app/risk.py");

  const mixedOverlay = JSON.stringify({
    overlay_version: 1,
    inputs: INPUTS,
    commit: ${JSON.stringify(SCAN_COMMIT)},
    modified: false,
    producer: { name: "crap", version: "0.1.72" },
    metrics: [{ name: "complexity", type: "count", granularity: "member", bad: "high" }, { name: "coverage", type: "ratio", granularity: "member", bad: "low" }, { name: "crap", type: "number", granularity: "member", bad: "high" }],
    values: {
      complexity: { "app/risk.py::classify": 8, "app/risk.py::heavy": 12 },
      coverage: { "app/risk.py::classify": 0.1, "app/risk.py::heavy": 0.5 },
      crap: { "app/risk.py::classify": 40, "app/risk.py::heavy": 30 },
    },
  });
  const sourcesOf = async (overlay, keys) => {
    explorer.dispose();
    host.replaceChildren();
    explorer = mountExplorer({ container: host, loaded: loadedFor(overlay), title: "demo", views: port, post: () => null, carried: null, scanHost: crapHost() });
    await tick();
    for (const folder of ["app", "src", "lib"]) {
      click(q('.tree .row[data-path="' + folder + '"] .reye'));
      await tick();
    }
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
  facts.mixed = await sourcesOf(mixedOverlay, ["crap/complexity", "crap/coverage"]);
  facts.single = await sourcesOf(${JSON.stringify(fresh)}, ["crap/complexity", "crap/coverage"]);

  const viewFile = JSON.stringify({
    schema_version: 4,
    description: "d",
    commit: ${JSON.stringify(SCAN_COMMIT)},
    notes: [
      { module: "app/risk.py", text: "Risk note", by: "Ken" },
      { module: "lib/none.py", text: "None note", by: "Ken" },
    ],
    steps: [{ kind: "pick", module: "app/risk.py" }, { kind: "pick", module: "lib/none.py" }],
  }) + "\\n";
  explorer.dispose();
  host.replaceChildren();
  const notedPort = fakeViews({ order: viewFile });
  explorer = mountExplorer({ container: host, loaded: loadedFor(${JSON.stringify(fresh)}), title: "demo", views: notedPort, post: () => null, carried: facts.carriedTicks, scanHost: crapHost() });
  await tick();
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
    f = await collectFacts<Facts>(HARNESS, "metrics-look");
  }, scaledTimeout(180000));

  it("puts Metrics before Legend and lists the metrics under the overlay's heading", () => {
    expect(f.controls.slice(-2)).toEqual(["Metrics", "Legend"]);
    expect(f.heading).toBe("crap");
    expect(f.rows.map((r: { key: string }) => r.key)).toEqual([
      "crap/complexity",
      "crap/coverage",
      "crap/crap",
    ]);
    expect(f.rows[0].text).toContain(
      "How many independent paths run through the function",
    );
    expect(f.rows[0].text).not.toContain("per member");
  });

  it("draws a row per measured metric in tick order and grows the box by each row plus 6px", () => {
    expect(f.heightBefore).toBe(40);
    expect(f.heightTwo).toBe(40 + 2 * 14 + 6);
    expect(f.risk.map((b: { metric: string }) => b.metric)).toEqual([
      "crap/complexity",
      "crap/coverage",
    ]);
    expect(f.detail[0]).toBe("bar 1 - 0 to 8, high is bad");
    expect(f.detail[1]).toBe("bar 2 - 0 to 100%, low is bad");
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

  it("draws no element for a metric a module has no value for", () => {
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

    expect(bar.label).toBe("a-v\u2026");
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
    expect(f.empty).toBe("No overlays were found.");
  });

  it("shows a current group with its age, no note and tickable rows", () => {
    const state = f.currentState;

    expect(state.headers[0].title).toBe("C.R.A.P.");
    expect(state.headers[0].age).toBe("measured 2 days ago");
    expect(state.headers[0].tooltip).toContain("crap 0.1.72 - at 0123456");
    expect(
      state.notes.filter((n: { text: string }) =>
        n.text.startsWith("Out of date"),
      ),
    ).toEqual([]);
    expect(state.rows.slice(0, 3).map((r: { text: string }) => r.text)).toEqual(
      [
        expect.stringContaining("Complexity"),
        expect.stringContaining("Coverage"),
        expect.stringContaining("C.R.A.P."),
      ],
    );
    expect(state.rows[0].disabled).toBe(false);
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

    expect(state.headers[0].title).toBe("C.R.A.P.");
    expect(state.notes[0]).toEqual({
      text: "3 modules out of date. Run C.R.A.P. from the Scan panel.",
      cls: "metric-note warn",
    });
    expect(state.rows[0].disabled).toBe(true);
    expect(state.headers[0].tooltip).toContain("crap 0.1.72 - at fffffff");
    expect(state.perMember).toBe(false);
    expect(state.chips).toBe(0);
    expect(f.afterStaleGroup.notes[0].cls).toBe("metric-note warn");
    expect(f.afterStale).toEqual({ bars: 0 });
    expect(f.staleClick).toBe(0);
    expect(f.afterStaleGroup.disabled).toBe(3);
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
      "C.R.A.P.",
      "Mutation",
    ]);
    expect(state.headers.every((h: { age: string }) => h.age === "")).toBe(
      true,
    );
    expect(state.notes.map((n: { text: string }) => n.text)).toEqual([
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
