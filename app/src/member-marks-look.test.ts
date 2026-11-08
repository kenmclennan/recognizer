import { beforeAll, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../scripts/pool-scale.mjs";
import { collectFacts, FAKE_WORKER, here, webkit } from "./look-page";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { loadedOf, mountExplorer } from ${JSON.stringify(here("look-support.ts"))};
import { fakeViews } from ${JSON.stringify(here("views-fake.ts"))};
${FAKE_WORKER}
Element.prototype.setPointerCapture = () => {};
Element.prototype.releasePointerCapture = () => {};

const ID = "p/a.py";
const selection = { extensions: [".py"], skip_directory_names: [], skip_directory_prefixes: [], skip_directory_suffixes: [], skip_directories_containing: [], skip_directory_globs: [], skip_file_globs: [] };
const method = (name, line, end_line) => ({ name, line, end_line });
const order = { name: "Order", exported: true, kind: "class", line: 1, methods: [method("total", 2, 3), method("apply", 5, 6)] };
const helper = { name: "helper", exported: true, kind: "function", line: 9, end_line: 10 };
const fresh = { name: "fresh", exported: true, kind: "function", line: 13, end_line: 14 };
const gone = { name: "gone", exported: true, kind: "function", line: 13, end_line: 14 };
const scanOf = (members) => ({ commit: "cur1234", modified: false, selection, modules: [{ id: ID, kind: "module", members }, { id: "p/b.py", kind: "module" }], edges: [{ from: ID, to: "p/b.py", kind: "depends", line: 1, names: ["f"] }], foreign: [] });
const loaded = loadedOf({ modules: [ID, "p/b.py"], scans: [{ file: "scan.json", scan: scanOf([order, helper, fresh]) }] });

const BASE_TEXT = ["class Order:", "    def total(self):", "        return 1", "", "    def apply(self):", "        return 2", "", "", "def helper():", "    return 3", "", "", "def gone():", "    return 4"].join("\\n");
const HEAD_TEXT = ["class Order:", "    def total(self):", "        return 10", "", "    def apply(self):", "        return 2", "", "", "def helper():", "    return 3", "", "", "def fresh():", "    return 5"].join("\\n");

const make = (extra) => JSON.stringify({ schema_version: 4, description: "d", commit: "cur1234", ...extra, steps: [{ kind: "pick", module: ID }] }, null, 2) + "\\n";
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

function mount(files, port) {
  const host = document.createElement("div");
  host.style.cssText = "width:1400px;height:800px;display:flex;flex-direction:column";
  document.body.append(host);
  mountExplorer({ container: host, loaded, title: "demo", views: port, post: () => null });
  const q = (selector) => host.querySelector(selector);
  const all = (selector) => [...host.querySelectorAll(selector)];
  return { host, q, all };
}

async function inspect(m) {
  click(m.q(".view-list"));
  click(m.q(".view-item"));
  await tick(120);
  click(m.q('.box[data-id="' + ID + '"] .box-body'));
  await tick();
  click(m.all(".bar-button").find((b) => b.title === "Contents (I)"));
  await tick(120);
}

function describeBands(m) {
  return m.all(".member-band").map((band) => ({
    title: band.title,
    svgs: band.querySelectorAll("svg").length,
    background: getComputedStyle(band).backgroundColor,
  }));
}

const facts = {};

(async () => {
  await tick();

  const planPort = fakeViews({ plan: make({ plan: true, proposed: [
    { module: ID, member: "Order.total", kind: "changes" },
    { module: ID, member: "Order.apply", kind: "removed" },
    { module: ID, member: "Order.discount", kind: "new" },
    { module: ID, member: "round_money", kind: "new" },
  ] }) });
  const plan = mount({}, planPort);
  await tick();
  await inspect(plan);
  const struck = plan.all(".card-member.removed");
  const planned = plan.all(".card-member.planned");
  const plannedCard = plan.all(".card.planned");
  facts.plan = {
    bands: describeBands(plan),
    removedStrike: struck.map((row) => getComputedStyle(row.querySelector(".card-code")).textDecorationLine),
    plannedItalic: planned.map((row) => getComputedStyle(row.querySelector(".card-code")).fontStyle),
    plannedLine: planned.map((row) => row.querySelector(".card-line").textContent),
    plannedCardKind: plannedCard.map((card) => card.querySelector(".card-kind").textContent),
    plannedCardLine: plannedCard.map((card) => card.querySelector(".card-line") === null ? "" : card.querySelector(".card-line").textContent),
    canvasMarks: plan.all(".canvas .member-band, .box .member-band, .box [class*='member']").length,
    boxText: plan.q('.box[data-id="' + ID + '"]').textContent,
    noteRows: plan.all(".inspector .note, .inspector-row.note").length,
  };
  click(plan.all("button").find((b) => b.textContent === "Legend"));
  facts.planLegend = plan.all(".canvas-legend .member-legend-row").filter((r) => !r.hidden).map((r) => ({ text: r.textContent, svg: r.querySelectorAll("svg").length }));
  facts.planLegendHeading = plan.all(".canvas-legend h4").filter((h) => !h.hidden).map((h) => h.textContent);

  const changePort = fakeViews({ chg: make({ change: { base: "main", head: "feat" } }) });
  changePort.ranges.set("main..feat", { baseCommit: "cur1234", headCommit: "cur1234", merged: false, changes: [{ status: "M", path: ID }] });
  changePort.members.set("main..feat", { baseScans: [scanOf([order, helper, gone])], files: [{ path: ID, base_text: BASE_TEXT, head_text: HEAD_TEXT }] });
  const change = mount({}, changePort);
  await tick();
  await inspect(change);
  await tick(120);
  facts.change = {
    bands: describeBands(change),
    removedStrike: change.all(".card.removed").map((row) => getComputedStyle(row.querySelector(".card-code")).textDecorationLine),
    canvasMarks: change.all(".box .member-band").length,
    calls: changePort.memberCalls,
  };
  click(change.all("button").find((b) => b.textContent === "Legend"));
  facts.changeLegend = change.all(".canvas-legend .member-legend-row").filter((r) => !r.hidden).map((r) => r.textContent);

  const unknownPort = fakeViews({ chg: make({ change: { base: "main", head: "feat" } }) });
  unknownPort.ranges.set("main..feat", { baseCommit: "cur1234", headCommit: "cur1234", merged: false, changes: [{ status: "M", path: ID }] });
  const unknown = mount({}, unknownPort);
  await tick();
  await inspect(unknown);
  await tick(120);
  facts.unknown = {
    bands: describeBands(unknown).length,
    notes: unknown.all(".inspector *").filter((n) => n.children.length === 0 && /Member marks/.test(n.textContent)).map((n) => n.textContent),
    calls: unknownPort.memberCalls,
  };

  document.getElementById("out").textContent = btoa(JSON.stringify(facts));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Band = { title: string; svgs: number; background: string };

type Facts = {
  plan: {
    bands: Band[];
    removedStrike: string[];
    plannedItalic: string[];
    plannedLine: string[];
    plannedCardKind: string[];
    plannedCardLine: string[];
    canvasMarks: number;
    boxText: string;
  };
  planLegend: { text: string; svg: number }[];
  planLegendHeading: string[];
  change: {
    bands: Band[];
    removedStrike: string[];
    canvasMarks: number;
    calls: string[];
  };
  changeLegend: string[];
  unknown: { bands: number; notes: string[]; calls: string[] };
};

describe.skipIf(webkit === undefined)("member marks in a real browser", () => {
  let f: Facts;

  beforeAll(async () => {
    f = await collectFacts<Facts>(HARNESS, "member-marks-look");
  }, scaledTimeout(180000));

  it("draws a band with an svg and a kind title on each marked plan row, coloured per kind", () => {
    const titles = f.plan.bands.map((band) => band.title).sort();

    expect(titles).toEqual(["changes", "new", "new", "removed"]);

    for (const band of f.plan.bands) {
      expect(band.svgs).toBe(1);
    }

    const byTitle = (title: string) =>
      f.plan.bands.filter((band) => band.title === title)[0]?.background;

    expect(
      new Set([byTitle("changes"), byTitle("new"), byTitle("removed")]).size,
    ).toBe(3);
  });

  it("strikes a removed row, and italicises a planned one with no line number", () => {
    expect(f.plan.removedStrike).toEqual(["line-through"]);
    expect(f.plan.plannedItalic).toEqual(["italic"]);
    expect(f.plan.plannedLine).toEqual([""]);
    expect(f.plan.plannedCardKind).toEqual(["Member"]);
    expect(f.plan.plannedCardLine).toEqual([""]);
  });

  it("draws no member mark or count on the canvas", () => {
    expect(f.plan.canvasMarks).toBe(0);
    expect(f.change.canvasMarks).toBe(0);
    expect(f.plan.boxText).not.toMatch(/member/i);
  });

  it("marks a change view from its git range: added, modified and removed", () => {
    expect(f.change.bands.map((band) => band.title).sort()).toEqual([
      "added",
      "modified",
      "removed",
    ]);
    expect(f.change.removedStrike).toEqual(["line-through"]);
    expect(f.change.calls).toEqual(["main..feat"]);
  });

  it("says marks need a scan, and draws none, when the range's members are unknown", () => {
    expect(f.unknown.calls).toEqual(["main..feat"]);
    expect(f.unknown.bands).toBe(0);
    expect(f.unknown.notes).toEqual(["Member marks need a scan of cur1234"]);
  });

  it("lists the three member icons under the module kinds in both legends", () => {
    expect(f.planLegend.map((row) => row.text)).toEqual([
      "New",
      "Changes",
      "Removed",
    ]);
    expect(f.planLegend.every((row) => row.svg === 1)).toBe(true);
    expect(f.planLegendHeading).toContain("Members, in the inspector");
    expect(f.changeLegend).toEqual(["Added", "Modified", "Removed"]);
  });
});
