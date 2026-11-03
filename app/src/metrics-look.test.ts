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
import { showExplorer } from ${JSON.stringify(here("explorer.ts"))};
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
const loadedOf = (overlay) => ({
  modules: ids,
  scans: [{ file: "scan.json", scan: scanOf() }],
  policy: null,
  notices: [],
  blocking: null,
  findings: [],
  sensors: [],
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
const barsOf = (id) => [...boxOf(id).querySelectorAll(".metric-bar")].map((bar) => ({
  metric: bar.dataset.metric,
  title: bar.querySelector("title").textContent,
  track: bar.querySelector(".metric-track").getAttribute("class"),
  trackWidth: Number(bar.querySelector(".metric-track").getAttribute("width")),
  fill: bar.querySelector(".metric-fill") ? bar.querySelector(".metric-fill").getAttribute("class") : null,
  fillWidth: bar.querySelector(".metric-fill") ? Number(bar.querySelector(".metric-fill").getAttribute("width")) : null,
  value: bar.querySelector(".metric-value").textContent,
  anchor: bar.querySelector(".metric-value").getAttribute("text-anchor"),
}));

(async () => {
  const mount = (overlay, carried) => showExplorer(host, loadedOf(overlay), "demo", () => {}, port, () => {}, carried, undefined, undefined, undefined, undefined, undefined, undefined, (text) => { footer.text = text; });
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
  facts.discsAfter = discs();
  facts.notePosition = Number(boxOf("app/risk.py").querySelector(".metric-bar rect").getAttribute("y"));
  facts.boxY = Number(boxOf("app/risk.py").querySelector(".box-body").getAttribute("y"));

  const carried = explorer.carry();
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

  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Facts = ReturnType<typeof JSON.parse>;

describe.skipIf(chrome === undefined)("metric bars on the canvas", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = await collectFacts<Facts>(HARNESS, "metrics-look");
  }, 180000);

  it("puts Metrics before Notes and Legend and lists the metrics under the overlay's heading", () => {
    expect(f.controls.slice(-3)).toEqual(["Metrics", "Notes", "Legend"]);
    expect(f.heading).toBe("crap - crap 0.1.0 - at 0123456");
    expect(f.rows.map((r: { key: string }) => r.key)).toEqual([
      "crap/complexity",
      "crap/coverage",
      "crap/crap",
    ]);
    expect(f.rows[0].text).toContain("Cyclomatic complexity of a function");
    expect(f.rows[0].text).toContain("per member");
  });

  it("adds a bar per ticked metric in tick order and grows the box by one row each", () => {
    expect(f.heightBefore).toBe(40);
    expect(f.heightTwo).toBe(40 + 2 * 14);
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
    expect(complexity.title).toBe("complexity 8, worst: classify");
    expect(complexity.anchor).toBe("end");
    expect(coverage.fill).toBe("metric-fill red");
    expect(coverage.fillWidth).toBeCloseTo(coverage.trackWidth * 0.1818, 5);
    expect(coverage.value).toBe("18%");
    expect(coverage.title).toBe("coverage 18%, worst: classify");
    expect(f.other[0].fill).toBe("metric-fill green");
    expect(f.other[0].value).toBe("1");
    expect(f.other[0].title).toBe("complexity 1, worst: pick");
  });

  it("draws an unmeasured module as a dashed empty track and a dash", () => {
    for (const bar of [...f.none, f.other[1]]) {
      expect(bar.track).toBe("metric-track unknown");
      expect(bar.fill).toBeNull();
      expect(bar.value).toBe("-");
      expect(bar.title).toMatch(/: not measured$/);
    }
  });

  it("leaves the discs unchanged", () => {
    expect(f.discsAfter).toEqual(f.discsBefore);
  });

  it("keeps the ticks across a rebuild and drops one when unticked", () => {
    expect(f.afterRebuild.bars).toBe(2);
    expect(f.afterRebuild.footer).toBe(
      "Showing complexity, coverage from crap",
    );
    expect(f.afterUntick.bars).toBe(1);
    expect(f.afterUntick.height).toBe(40 + 14);
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
