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
const selection = { extensions: [".py"], skip_directory_names: [], skip_directory_prefixes: [], skip_directory_suffixes: [], skip_directories_containing: [], skip_directory_globs: [], skip_file_globs: [] };
const scan = { commit: "cur1234", selection, modules: IDS.map((id) => ({ id, kind: "module" })), edges: [edge], foreign: [] };
const loaded = loadedOf({ modules: IDS, scans: [{ file: "scan.json", scan }] });

const PROPOSED = [
  { module: "p/new.py", kind: "new" },
  { module: "p/a.py", kind: "changes" },
  { module: "p/c.py", kind: "moves", from: "q/old.py" },
  { module: "p/z.py", kind: "moves-and-changes", from: "q/z.py" },
  { module: "p/b.py", kind: "removed" },
];
const make = (extra, steps) => JSON.stringify({ schema_version: 4, description: "d", commit: "cur1234", ...extra, steps: steps || [{ kind: "pick", module: "p/a.py" }, { kind: "pick", module: "p/b.py" }, { kind: "pick", module: "p/c.py" }] }, null, 2) + "\\n";
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

function mount(files) {
  const host = document.createElement("div");
  host.style.cssText = "width:1400px;height:800px;display:flex;flex-direction:column";
  document.body.append(host);
  const port = fakeViews(files);
  mountExplorer({ container: host, loaded, title: "demo", views: port, post: () => null });
  const q = (selector) => host.querySelector(selector);
  const all = (selector) => [...host.querySelectorAll(selector)];
  return { host, port, q, all };
}

const open = async (m) => { click(m.q(".view-list")); click(m.q(".view-item")); await tick(80); };
const stroke = (node) => getComputedStyle(node).stroke;
const boxOf = (m, id) => m.q('.box[data-id="' + id + '"]');
const facts = {};

(async () => {
  await tick();

  const plan = mount({ plan: make({ plan: true, proposed: PROPOSED, notes: [{ module: "p/new.py", text: "Will exist", by: "Ken" }] }) });
  await tick();
  await open(plan);
  for (let i = 0; i < 2; i += 1) {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await tick();
  }
  facts.selectedAtStart = plan.all(".box.selected").length;
  const moveBox = boxOf(plan, "p/c.py");
  facts.plan = {
    classes: Object.fromEntries(PROPOSED.map((entry) => [entry.module, boxOf(plan, entry.module) === null ? null : [...boxOf(plan, entry.module).classList].filter((c) => c.startsWith("proposed-"))])),
    strokes: ["p/new.py", "p/a.py", "p/c.py", "p/b.py"].map((id) => stroke(boxOf(plan, id).querySelector(".box-body"))),
    widths: ["p/new.py", "p/a.py", "p/c.py", "p/b.py"].map((id) => getComputedStyle(boxOf(plan, id).querySelector(".box-body")).strokeWidth),
    chips: plan.all(".chip").length,
    removedStrike: getComputedStyle(boxOf(plan, "p/b.py").querySelector(".name")).textDecorationLine,
    newItalic: getComputedStyle(boxOf(plan, "p/new.py").querySelector(".name")).fontStyle,
    plainItalic: getComputedStyle(boxOf(plan, "p/d.py") ? boxOf(plan, "p/d.py").querySelector(".name") : boxOf(plan, "p/a.py").querySelector(".name")).fontStyle,
    splitPaths: plan.all('.box[data-id="p/z.py"] .split').map((n) => stroke(n)),
    splitBody: stroke(boxOf(plan, "p/z.py").querySelector(".box-body")),
    ghosts: plan.all(".box.ghost").map((g) => ({ text: g.textContent, dash: getComputedStyle(g.querySelector(".box-body")).strokeDasharray, selectable: g.hasAttribute("data-kind") })),
    wires: plan.all(".ghost-wire .wire").map((w) => ({ dash: getComputedStyle(w).strokeDasharray, stroke: getComputedStyle(w).stroke })),
    moveStroke: stroke(moveBox.querySelector(".box-body")),
    frames: plan.all(".frame").map((f) => f.dataset.path).sort(),
    tag: { text: plan.q(".view-plan-tag").textContent, shown: !plan.q(".view-plan-tag").hidden },
    tagBesideName: plan.q(".view-plan-tag").previousElementSibling !== null,
    rangeChipHidden: plan.q(".view-range-chip").hidden,
    modified: plan.q(".view-modified") === null ? false : !plan.q(".view-modified").hidden,
    noteMarks: plan.all(".note-mark").map((n) => n.dataset.noteMark),
  };
  click(plan.all("button").find((b) => b.textContent === "Legend"));
  facts.legend = {
    plan: plan.all(".canvas-legend .plan-legend-row").filter((r) => !r.hidden).map((r) => r.textContent),
    change: plan.all(".canvas-legend .change-legend-row").filter((r) => !r.hidden).length,
  };
  click(moveBox.querySelector(".box-body"));
  await tick();
  click(plan.all(".bar-button").find((b) => b.title === "Contents (I)"));
  await tick();
  facts.inspector = { proposed: plan.q(".ih-proposed").textContent, from: plan.q(".ih-from").textContent };
  facts.takeOffOnPlanned = (click(boxOf(plan, "p/new.py").querySelector(".box-body")), await tick(), plan.all(".bar-button[title^='Take off']").length);
  facts.takeOffOnReal = (click(boxOf(plan, "p/a.py").querySelector(".box-body")), await tick(), plan.all(".bar-button[title^='Take off']").length);
  facts.plannedInspector = (click(boxOf(plan, "p/new.py").querySelector(".box-body")), await tick(), plan.q(".ih-proposed").textContent);

  const change = mount({ chg: make({ change: { base: "main", head: "feat" } }) });
  change.port.ranges.set("main..feat", { baseCommit: "cur1234", headCommit: "feed01", merged: false, changes: [{ status: "M", path: "p/a.py" }] });
  await tick();
  await open(change);
  click(change.all("button").find((b) => b.textContent === "Legend"));
  facts.change = {
    tag: change.q(".view-plan-tag").hidden,
    chip: !change.q(".view-range-chip").hidden,
    planRows: change.all(".canvas-legend .plan-legend-row").filter((r) => !r.hidden).length,
    changeRows: change.all(".canvas-legend .change-legend-row").filter((r) => !r.hidden).length,
    proposedBoxes: change.all('.box[class*="proposed-"]').length,
  };

  const plain = mount({ w: make({}) });
  await tick();
  await open(plain);
  facts.plain = { tag: plain.q(".view-plan-tag").hidden, proposedBoxes: plain.all('.box[class*="proposed-"]').length, ghosts: plain.all(".box.ghost").length };

  document.getElementById("out").textContent = btoa(JSON.stringify(facts));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Facts = {
  selectedAtStart: number;
  plan: {
    classes: Record<string, string[] | null>;
    strokes: string[];
    widths: string[];
    chips: number;
    removedStrike: string;
    newItalic: string;
    plainItalic: string;
    splitPaths: string[];
    splitBody: string;
    ghosts: { text: string; dash: string; selectable: boolean }[];
    wires: { dash: string; stroke: string }[];
    moveStroke: string;
    frames: string[];
    tag: { text: string; shown: boolean };
    tagBesideName: boolean;
    rangeChipHidden: boolean;
    modified: boolean;
    noteMarks: string[];
  };
  legend: { plan: string[]; change: number };
  inspector: { proposed: string; from: string };
  takeOffOnPlanned: number;
  takeOffOnReal: number;
  plannedInspector: string;
  change: {
    tag: boolean;
    chip: boolean;
    planRows: number;
    changeRows: number;
    proposedBoxes: number;
  };
  plain: { tag: boolean; proposedBoxes: number; ghosts: number };
};

describe.skipIf(webkit === undefined)("plan views in a real browser", () => {
  let f: Facts;

  beforeAll(async () => {
    f = await collectFacts<Facts>(HARNESS, "plan-views-look");
  }, scaledTimeout(180000));

  it("draws each proposed change on its box, including modules the scan does not hold", () => {
    expect(f.plan.classes).toEqual({
      "p/new.py": ["proposed-new"],
      "p/a.py": ["proposed-changes"],
      "p/c.py": ["proposed-moves"],
      "p/z.py": ["proposed-moves-and-changes"],
      "p/b.py": ["proposed-removed"],
    });
    expect(f.plan.frames).toContain("p");
    expect(f.plan.frames).toContain("q");
  });

  it("draws five distinct solid 1px strokes and no chip", () => {
    expect(f.selectedAtStart).toBe(0);
    expect(new Set(f.plan.strokes).size).toBe(4);
    expect(f.plan.widths).toEqual(["1px", "1px", "1px", "1px"]);
    expect(f.plan.chips).toBe(0);
  });

  it("strikes a removed name through and italicises a new one", () => {
    expect(f.plan.removedStrike).toBe("line-through");
    expect(f.plan.newItalic).toBe("italic");
    expect(f.plan.plainItalic).not.toBe("italic");
  });

  it("splits the border of a moved and changed box into two strokes that differ", () => {
    expect(f.plan.splitPaths).toHaveLength(2);
    expect(f.plan.splitPaths[0]).not.toBe(f.plan.splitPaths[1]);
    expect(f.plan.splitBody).toBe("none");
  });

  it("draws a dashed ghost at each old path with a dashed teal arrow to the new box", () => {
    expect(f.plan.ghosts).toHaveLength(2);

    for (const ghost of f.plan.ghosts) {
      expect(ghost.dash).not.toBe("none");
      expect(ghost.selectable).toBe(false);
    }

    expect(f.plan.ghosts.map((g) => g.text).sort()).toEqual([
      "old.pymoving to p/",
      "z.pymoving to p/",
    ]);
    expect(f.plan.wires).toHaveLength(2);

    for (const wire of f.plan.wires) {
      expect(wire.dash).not.toBe("none");
      expect(wire.stroke).toBe(f.plan.moveStroke);
    }
  });

  it("shows the Plan tag for a plan only, and opens a plan unmodified", () => {
    expect(f.plan.tag).toEqual({ text: "Plan", shown: true });
    expect(f.plan.tagBesideName).toBe(true);
    expect(f.plan.rangeChipHidden).toBe(true);
    expect(f.plan.modified).toBe(false);
    expect(f.change.tag).toBe(true);
    expect(f.change.chip).toBe(true);
    expect(f.plain.tag).toBe(true);
  });

  it("marks a note on a planned module", () => {
    expect(f.plan.noteMarks).toContain("p/new.py");
  });

  it("lists the six plan rows and none of the change rows in a plan's legend", () => {
    expect(f.legend.plan).toEqual([
      "New",
      "Changes",
      "Moves",
      "Moves + changes",
      "Removed",
      "Where a moved module was",
    ]);
    expect(f.legend.change).toBe(0);
    expect(f.change.planRows).toBe(0);
    expect(f.change.changeRows).toBe(3);
  });

  it("shows the proposed change and the source path in the inspector", () => {
    expect(f.inspector.proposed).toBe("Proposed change: Moves, code unchanged");
    expect(f.inspector.from).toBe("from q/old.py");
    expect(f.plannedInspector).toBe("Proposed change: New");
  });

  it("offers Take off on a module in the scan and not on a planned box", () => {
    expect(f.takeOffOnPlanned).toBe(0);
    expect(f.takeOffOnReal).toBe(1);
  });

  it("leaves a change view and a plain view as they were", () => {
    expect(f.change.proposedBoxes).toBe(0);
    expect(f.plain).toEqual({ tag: true, proposedBoxes: 0, ghosts: 0 });
  });
});
