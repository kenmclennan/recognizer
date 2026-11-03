import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { chrome, collectFacts, FAKE_WORKER, here } from "./look-page";

const SCAN_COMMIT = "0123456789abcdef0123456789abcdef01234567";

const shipped = JSON.parse(
  readFileSync(here("../../schema/overlay-examples/valid/crap.json"), "utf8"),
);
const fresh = JSON.stringify({ ...shipped, commit: SCAN_COMMIT });
const stale = JSON.stringify({
  ...shipped,
  commit: "ffffffffffffffffffffffffffffffffffffffff",
});

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { loadedOf, mountExplorer } from ${JSON.stringify(here("look-support.ts"))};
import { fakeViews } from ${JSON.stringify(here("views-fake.ts"))};
${FAKE_WORKER}

const ids = ["app/risk.py", "src/other.ts", "lib/none.py"];
const scanOf = () => ({
  commit: ${JSON.stringify(SCAN_COMMIT)},
  modified: false,
  modules: ids.map((id) => ({ id, kind: "module" })),
  edges: [{ from: ids[0], to: ids[1], kind: "depends", line: 1, names: ["X"] }],
  foreign: [],
});
const loadedFor = (overlay) => loadedOf({
  modules: ids,
  scans: [{ file: "scan.json", scan: scanOf() }],
  overlays: overlay === null ? [] : [{ name: "crap", text: overlay }],
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 60));
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const host = document.getElementById("content");
const q = (selector) => host.querySelector(selector);
const qa = (selector) => [...host.querySelectorAll(selector)];
const port = fakeViews({});
const footer = { text: null };
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
  const mount = (overlay, carried) => mountExplorer({ container: host, loaded: loadedFor(overlay), title: "demo", views: port, post: () => null, carried, showMetrics: (text) => { footer.text = text; } });
  let explorer = mount(${JSON.stringify(fresh)}, null);
  await tick();
  for (const folder of ["app", "src", "lib"]) {
    click(q('.tree .row[data-path="' + folder + '"] .rcheck'));
    await tick();
  }

  facts.controls = qa(".controls .control").map((b) => b.textContent);
  facts.discsBefore = discs();
  facts.heightBefore = heightOf("app/risk.py");

  click(q(".metrics-toggle"));
  await tick();
  facts.heading = q(".canvas-metrics h4").textContent;
  facts.rows = qa(".metric-row").map((r) => ({ key: r.dataset.metric, text: r.textContent }));

  click(q('.metric-row[data-metric="crap/complexity"]'));
  await tick();
  click(q('.metric-row[data-metric="crap/coverage"]'));
  await tick();
  facts.detail = qa(".metric-row .metric-detail").map((d) => d.textContent);
  facts.footer = footer.text;
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
  facts.afterRebuild = { bars: barsOf("app/risk.py").length, footer: footer.text };

  click(q(".metrics-toggle"));
  await tick();
  click(q('.metric-row[data-metric="crap/coverage"]'));
  await tick();
  facts.afterUntick = { bars: barsOf("app/risk.py").length, height: heightOf("app/risk.py"), footer: footer.text };

  const staleCarried = explorer.carry();
  explorer.dispose();
  host.replaceChildren();
  explorer = mount(${JSON.stringify(stale)}, staleCarried);
  await tick();
  facts.afterStale = { bars: barsOf("app/risk.py").length, footer: footer.text };
  click(q(".metrics-toggle"));
  await tick();
  facts.stale = {
    heading: q(".canvas-metrics h4").textContent,
    disabled: qa(".metric-row.disabled").length,
    chips: qa(".metric-chip").map((c) => c.textContent),
  };
  click(q('.metric-row[data-metric="crap/complexity"]'));
  await tick();
  facts.staleClick = barsOf("app/risk.py").length;

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
    commit: ${JSON.stringify(SCAN_COMMIT)},
    modified: false,
    producer: { name: "long", version: "0.1.0" },
    metrics: [{ name: "a-very-long-metric", type: "count", granularity: "member", bad: "high" }],
    values: { "a-very-long-metric": { "app/risk.py::classify": 3 } },
  });
  explorer = mountExplorer({ container: host, loaded: loadedOf({ modules: ids, scans: [{ file: "scan.json", scan: scanOf() }], overlays: [{ name: "long", text: longOverlay }] }), title: "demo", views: port, post: () => null, carried: null, showMetrics: () => {} });
  await tick();
  for (const folder of ["app", "src", "lib"]) {
    click(q('.tree .row[data-path="' + folder + '"] .rcheck'));
    await tick();
  }
  click(q(".metrics-toggle"));
  await tick();
  click(q('.metric-row[data-metric="long/a-very-long-metric"]'));
  await tick();
  facts.long = barsOf("app/risk.py");

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
  explorer = mountExplorer({ container: host, loaded: loadedFor(${JSON.stringify(fresh)}), title: "demo", views: notedPort, post: () => null, carried: facts.carriedTicks, showMetrics: () => {} });
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

describe.skipIf(chrome === undefined)("metric bars on the canvas", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = await collectFacts<Facts>(HARNESS, "metrics-look");
  }, 180000);

  it("puts Metrics before Legend and lists the metrics under the overlay's heading", () => {
    expect(f.controls.slice(-2)).toEqual(["Metrics", "Legend"]);
    expect(f.heading).toBe("crap - crap 0.1.0 - at 0123456");
    expect(f.rows.map((r: { key: string }) => r.key)).toEqual([
      "crap/complexity",
      "crap/coverage",
      "crap/crap",
    ]);
    expect(f.rows[0].text).toContain("Cyclomatic complexity of a function");
    expect(f.rows[0].text).toContain("per member");
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
    expect(f.footer).toBe("Showing complexity, coverage from crap");
  });

  it("colours and sizes the bars by the worst member and titles them", () => {
    const [complexity, coverage] = f.risk;

    expect(complexity.fill).toBe("metric-fill red");
    expect(complexity.fillWidth).toBe(complexity.trackWidth);
    expect(complexity.value).toBe("8");
    expect(complexity.title).toBe("Cyclomatic complexity 8, worst: classify");
    expect(complexity.anchor).toBe("end");
    expect(coverage.fill).toBe("metric-fill red");
    expect(coverage.fillWidth).toBeCloseTo(coverage.trackWidth * 0.1818, 5);
    expect(coverage.value).toBe("18%");
    expect(coverage.title).toBe("Coverage 18%, worst: classify");
    expect(f.other[0].fill).toBe("metric-fill green");
    expect(f.other[0].value).toBe("1");
    expect(f.other[0].title).toBe("Cyclomatic complexity 1, worst: pick");
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
    expect(f.afterRebuild.footer).toBe(
      "Showing complexity, coverage from crap",
    );
    expect(f.afterUntick.bars).toBe(1);
    expect(f.afterUntick.height).toBe(40 + 14 + 6);
    expect(f.afterUntick.footer).toBe("Showing complexity from crap");
  });

  it("says no overlays were found when there are none", () => {
    expect(f.empty).toBe("No overlays were found.");
  });

  it("disables and chips a stale overlay's rows and drops its ticks", () => {
    expect(f.afterStale).toEqual({ bars: 0, footer: null });
    expect(f.stale.heading).toBe(
      "crap - crap 0.1.0 - from fffffff, not the scan's",
    );
    expect(f.stale.disabled).toBe(3);
    expect(f.stale.chips).toEqual(["stale", "stale", "stale"]);
    expect(f.staleClick).toBe(0);
  });
});
