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

const IDS = ["p/a.py", "p/b.py", "p/c.py", "p/d.py"];
const edge = { from: "p/a.py", to: "p/b.py", kind: "depends", line: 1, names: ["f"] };
const selection = { extensions: [".py"], skip_directory_names: [], skip_directory_prefixes: [], skip_directory_suffixes: [], skip_directories_containing: [], skip_file_globs: [] };
const scan = { commit: "cur1234", selection, modules: IDS.map((id) => ({ id, kind: "module" })), edges: [edge], foreign: [] };
const baseScan = { commit: "base999", selection, modules: [...IDS, "p/gone.py"].map((id) => ({ id, kind: "module" })), edges: [edge], foreign: [] };
const loaded = loadedOf({ modules: IDS, scans: [{ file: "scan.json", scan }] });

const make = (extra, steps) => JSON.stringify({ schema_version: 4, description: "d", commit: "cur1234", ...extra, steps: steps || [{ kind: "pick", module: "p/a.py" }] }, null, 2) + "\\n";
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

function mount(files, options) {
  const host = document.createElement("div");
  host.style.cssText = "width:1400px;height:800px;display:flex;flex-direction:column";
  document.body.append(host);
  const port = fakeViews(files, options);
  const state = { count: "" };
  const lines = [];
  const post = (input) => { if (input.action && input.action.label === "Undo") lines.push({ text: input.text, onUndo: input.action.run }); return lines.length; };
  const withdraw = () => lines.push(null);
  const explorer = mountExplorer({ container: host, loaded, title: "demo", onCount: (text) => { state.count = text; }, views: port, post, withdraw });
  const q = (selector) => host.querySelector(selector);
  const all = (selector) => [...host.querySelectorAll(selector)];
  return { host, port, state, lines, q, all, explorer };
}

const facts = {};
const legendRows = (m) => m.all(".canvas-legend .change-legend-row").filter((r) => !r.hidden).map((r) => r.textContent);
const openLegend = (m) => click(m.all("button").find((b) => b.textContent === "Legend"));

(async () => {
  await tick();

  const five = mount(Object.fromEntries([1, 2, 3, 4, 5].map((n) => ["v" + n, make({})])));
  await tick();
  click(five.q(".view-list"));
  facts.five = { items: five.all(".view-item").length, all: five.all(".view-all").length, chips: five.all(".view-item-chip").length };

  const six = mount(Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => ["v" + n, make({})])));
  await tick();
  click(six.q(".view-list"));
  facts.six = { items: six.all(".view-item").length, all: six.q(".view-all").textContent };
  click(six.q(".view-all"));
  await tick();
  facts.sixPanel = { open: getComputedStyle(six.q(".views-panel")).display !== "none", rows: six.all(".views-row").length, menuHidden: six.q(".view-menu").hidden };

  const rails = mount({});
  await tick();
  facts.rail = rails.all(".rail button").map((b) => b.getAttribute("data-label"));

  const panel = mount({
    alpha: make({}, [{ kind: "pick", module: "p/a.py" }]),
    beta: make({}),
    live: make({ change: { base: "main", head: "feat" } }),
    merged: make({ change: { base: "main", head: "old" } }),
    ghost: make({ change: { base: "main", head: "ghost" } }),
    broken: make({}, [{ kind: "pick", module: "p/missing.py" }]),
    noted: make({ notes: [{ module: "p/a.py", text: "x", by: "Ken" }] }),
  });
  panel.port.ranges.set("main..feat", { baseCommit: "base999", headCommit: "feed01", merged: false, changes: [] });
  panel.port.ranges.set("main..old", { baseCommit: "base999", headCommit: "0ld001", merged: true, changes: [] });
  panel.port.ranges.set("main..ghost", { baseCommit: "base999", headCommit: null, merged: false, changes: [] });
  await tick();
  click(panel.q(".rail-views"));
  await tick();
  const rowOf = (name) => panel.all(".views-row").find((r) => r.dataset.view === name);
  facts.panel = {
    live: panel.all(".views-row:not(.stale):not(.invalid)").map((r) => r.dataset.view),
    stale: panel.all(".views-row.stale").map((r) => [r.dataset.view, [...r.querySelectorAll(".views-row-reason")].map((n) => n.textContent)]),
    heading: panel.q(".views-stale-header").textContent,
    chips: panel.all(".views-panel [class*='chip']").length,
    descriptions: Object.fromEntries(["alpha", "beta"].map((n) => [n, rowOf(n).querySelector(".views-row-description").textContent])),
    metas: Object.fromEntries(["alpha", "beta", "live"].map((n) => [n, rowOf(n).querySelector(".views-row-meta")?.textContent ?? null])),
    notes: rowOf("noted").querySelector(".views-row-meta").textContent,
    liveHasDelete: rowOf("alpha").querySelector(".views-delete") !== null,
    files: panel.port.files.size,
    railIndex: panel.all(".rail button").map((b) => b.getAttribute("data-label")).indexOf("Views"),
  };
  panel.port.edit("alpha", make({}, [{ kind: "pick", module: "p/a.py" }]));
  await tick();
  facts.panelAfterRefresh = { files: panel.port.files.size, removed: panel.port.removed.length };

  click(rowOf("merged").querySelector(".views-delete"));
  await tick();
  facts.deleted = { has: panel.port.files.has("merged"), line: panel.lines[panel.lines.length - 1] && panel.lines[panel.lines.length - 1].text, staleLeft: panel.all(".views-row.stale").map((r) => r.dataset.view) };
  panel.lines[panel.lines.length - 1].onUndo();
  await tick();
  facts.undone = { has: panel.port.files.has("merged"), staleBack: panel.all(".views-row.stale").map((r) => r.dataset.view) };

  const offline = mount({ live: make({ change: { base: "main", head: "feat" } }) });
  await tick();
  click(offline.q(".rail-views"));
  await tick();
  facts.offline = { stale: offline.all(".views-row.stale").length, live: offline.all(".views-row").length };

  const change = mount({ chg: make({ change: { base: "main", head: "feat" } }) });
  change.port.ranges.set("main..feat", {
    baseCommit: "base999",
    headCommit: "feed01",
    merged: false,
    changes: [{ status: "M", path: "p/a.py" }, { status: "A", path: "p/b.py" }, { status: "D", path: "p/gone.py" }, { status: "A", path: "p/zz.py" }],
  });
  change.port.scansByCommit.set("base999", [baseScan]);
  await tick();
  click(change.q(".view-list"));
  click(change.q(".view-item"));
  await tick(80);
  facts.change = {
    boxes: change.all(".box").map((b) => [b.dataset.id, b.classList.contains("mark-added") ? "added" : b.classList.contains("mark-modified") ? "modified" : b.classList.contains("mark-removed") ? "removed" : ""]),
    removedBoxes: change.all(".removed-box").map((b) => b.dataset.removed),
    removedDash: getComputedStyle(change.q(".removed-box .box-body")).strokeDasharray,
    removedStrike: getComputedStyle(change.q(".removed-box .name")).textDecorationLine,
    legend: (openLegend(change), legendRows(change)),
    chip: change.q(".view-range-chip").textContent,
    footer: change.state.count,
    bodyText: change.host.textContent.includes("proposed"),
  };

  const gone = mount({ gone: make({ change: { base: "main", head: "ghost" } }) });
  gone.port.ranges.set("main..ghost", { baseCommit: "base999", headCommit: null, merged: false, changes: [] });
  await tick();
  click(gone.q(".view-list"));
  click(gone.q(".view-item"));
  await tick(80);
  openLegend(gone);
  facts.headGone = { boxes: gone.all(".box").map((b) => b.dataset.id), footer: gone.state.count, legendShown: legendRows(gone).length > 0, proposed: gone.host.textContent.includes("proposed") };

  const linked = mount({ chg: make({ change: { base: "main", head: "feat" } }) });
  linked.port.ranges.set("main..feat", {
    baseCommit: "base999",
    headCommit: "feed01",
    merged: false,
    changes: [{ status: "M", path: "p/a.py" }, { status: "A", path: "p/b.py" }],
  });
  await tick();
  linked.port.pending.push("chg");
  linked.explorer.openLinkedView();
  await tick(80);
  openLegend(linked);
  facts.linked = {
    marks: linked.all(".box").map((b) => [b.dataset.id, b.classList.contains("mark-added") ? "added" : b.classList.contains("mark-modified") ? "modified" : ""]),
    footer: linked.state.count,
    legend: legendRows(linked),
    chip: linked.q(".view-range-chip").textContent,
  };

  const carried = linked.explorer.carry();
  linked.explorer.dispose();
  linked.host.replaceChildren();
  linked.state.count = "";
  mountExplorer({ container: linked.host, loaded, title: "demo", onCount: (text) => { linked.state.count = text; }, views: linked.port, post: () => null, carried });
  await tick(120);
  facts.rebuilt = {
    marks: linked.all(".box").map((b) => [b.dataset.id, b.classList.contains("mark-added") ? "added" : b.classList.contains("mark-modified") ? "modified" : ""]),
    footer: linked.state.count,
    chip: linked.q(".view-range-chip").textContent,
  };

  const plainLegend = mount({ w: make({}, [{ kind: "pick", module: "p/a.py" }]) });
  await tick();
  click(plainLegend.q(".view-list"));
  click(plainLegend.q(".view-item"));
  await tick(80);
  openLegend(plainLegend);
  facts.plainLegend = legendRows(plainLegend);

  const late = mount({ chg: make({ change: { base: "main", head: "feat" } }) }, { delayRanges: true });
  late.port.ranges.set("main..feat", { baseCommit: "cur1234", headCommit: "feed01", merged: false, changes: [{ status: "A", path: "p/c.py" }] });
  await tick();
  click(late.q(".view-list"));
  click(late.q(".view-item"));
  await tick(80);
  facts.lateBefore = late.all(".box").map((b) => b.dataset.id);
  await late.port.settle();
  await tick(80);
  facts.lateAfter = late.all(".box").map((b) => b.dataset.id);

  document.getElementById("out").textContent = btoa(JSON.stringify(facts));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Facts = {
  five: { items: number; all: number; chips: number };
  six: { items: number; all: string };
  sixPanel: { open: boolean; rows: number; menuHidden: boolean };
  rail: string[];
  panel: {
    live: string[];
    stale: [string, string[]][];
    heading: string;
    chips: number;
    descriptions: Record<string, string>;
    metas: Record<string, string | null>;
    notes: string;
    liveHasDelete: boolean;
    files: number;
    railIndex: number;
  };
  panelAfterRefresh: { files: number; removed: number };
  deleted: { has: boolean; line: string; staleLeft: string[] };
  undone: { has: boolean; staleBack: string[] };
  offline: { stale: number; live: number };
  change: {
    boxes: [string, string][];
    removedBoxes: string[];
    removedDash: string;
    removedStrike: string;
    legend: string[];
    chip: string;
    footer: string;
    bodyText: boolean;
  };
  headGone: {
    boxes: string[];
    footer: string;
    legendShown: boolean;
    proposed: boolean;
  };
  linked: {
    marks: [string, string][];
    footer: string;
    legend: string[];
    chip: string;
  };
  rebuilt: { marks: [string, string][]; footer: string; chip: string };
  plainLegend: string[];
  lateBefore: string[];
  lateAfter: string[];
};

describe.skipIf(webkit === undefined)("change views in a real browser", () => {
  let f: Facts;

  beforeAll(async () => {
    f = await collectFacts<Facts>(HARNESS, "change-views-look");
  }, scaledTimeout(180000));

  it("drops down five views with no chip and offers All views only past five", () => {
    expect(f.five).toEqual({ items: 5, all: 0, chips: 0 });
    expect(f.six.items).toBe(5);
    expect(f.six.all).toBe("All views (6)");
  });

  it("opens the Views panel from the All views link", () => {
    expect(f.sixPanel).toEqual({ open: true, rows: 6, menuHidden: true });
  });

  it("puts the Views icon between Files and Notes", () => {
    expect(f.rail.slice(0, 3)).toEqual(["Files", "Views", "Notes"]);
    expect(f.panel.railIndex).toBe(1);
  });

  it("lists live views first with ranges and note counts, then a Stale heading", () => {
    expect(f.panel.live).toEqual(["alpha", "beta", "live", "noted"]);
    expect(f.panel.chips).toBe(0);
    expect(f.panel.descriptions).toEqual({ alpha: "d", beta: "d" });
    expect(f.panel.metas).toEqual({
      alpha: null,
      beta: null,
      live: "Changes main to feat",
    });
    expect(f.panel.notes).toBe("1 note");
    expect(f.panel.heading).toBe("Stale");
    expect(f.panel.liveHasDelete).toBe(false);
  });

  it("lists the stale views with their reasons and deletes nothing on its own", () => {
    expect(f.panel.stale).toEqual([
      ["broken", ["step 1 p/missing.py no longer resolves"]],
      ["ghost", ["head ghost is not in the repository"]],
      ["merged", ["head old is merged into main"]],
    ]);
    expect(f.panel.files).toBe(7);
    expect(f.panelAfterRefresh).toEqual({ files: 7, removed: 0 });
  });

  it("deletes on the click and restores the file from the footer Undo", () => {
    expect(f.deleted.has).toBe(false);
    expect(f.deleted.line).toBe("Deleted merged");
    expect(f.deleted.staleLeft).toEqual(["broken", "ghost"]);
    expect(f.undone.has).toBe(true);
    expect(f.undone.staleBack).toEqual(["broken", "ghost", "merged"]);
  });

  it("treats a missing git answer as live, never stale", () => {
    expect(f.offline).toEqual({ stale: 0, live: 1 });
  });

  it("marks added, modified and removed modules with a dashed struck removed box", () => {
    expect(f.change.boxes).toEqual(
      expect.arrayContaining([
        ["p/a.py", "modified"],
        ["p/b.py", "added"],
        ["p/gone.py", "removed"],
      ]),
    );
    expect(f.change.removedBoxes).toEqual(["p/gone.py"]);
    expect(f.change.removedDash).not.toBe("none");
    expect(f.change.removedStrike).toBe("line-through");
  });

  it("names the three marks in a legend, shows the range chip and the footer line", () => {
    expect(f.change.legend).toEqual(["added", "modified", "removed"]);
    expect(f.change.chip).toBe("main..feat");
    expect(f.change.footer).toContain("diffed against main..feat just now");
    expect(f.change.footer).toContain("1 changed files matched no module");
    expect(f.change.bodyText).toBe(false);
  });

  it("lands the marks, footer line, chip and legend entries when a change view is opened by link", () => {
    expect(f.linked.marks).toEqual(
      expect.arrayContaining([
        ["p/a.py", "modified"],
        ["p/b.py", "added"],
      ]),
    );
    expect(f.linked.footer).toContain("diffed against main..feat just now");
    expect(f.linked.chip).toBe("main..feat");
    expect(f.linked.legend).toEqual(["added", "modified", "removed"]);
  });

  it("lands the marks again when a rescan rebuilds the explorer around an open change view", () => {
    expect(f.rebuilt.marks).toEqual(
      expect.arrayContaining([
        ["p/a.py", "modified"],
        ["p/b.py", "added"],
      ]),
    );
    expect(f.rebuilt.footer).toContain("diffed against main..feat just now");
    expect(f.rebuilt.chip).toBe("main..feat");
  });

  it("carries the change entries in the Legend only while a change view is open", () => {
    expect(f.plainLegend).toEqual([]);
  });

  it("opens a view whose head is gone with its picks only and says so", () => {
    expect(f.headGone.boxes).toEqual(["p/a.py"]);
    expect(f.headGone.footer).toContain("head ghost is not in the repository");
    expect(f.headGone.legendShown).toBe(false);
    expect(f.headGone.proposed).toBe(false);
  });

  it("draws the picks first and the marks when the range resolves late", () => {
    expect(f.lateBefore).toEqual(["p/a.py"]);
    expect(f.lateAfter).toEqual(expect.arrayContaining(["p/a.py", "p/c.py"]));
  });
});
