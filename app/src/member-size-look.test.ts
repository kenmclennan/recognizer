import { beforeAll, describe, expect, it } from "vitest";
import { HUGE_FUNCTION, LONG_FUNCTION } from "./function-length";
import { collectFacts, here, webkit } from "./look-page";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { buildInspectorView } from ${JSON.stringify(here("inspector-view.ts"))};
import { compactFolders } from ${JSON.stringify(here("folder-compaction.ts"))};
import { inspectorContent } from ${JSON.stringify(here("inspector-model.ts"))};
import { DEFAULT_LIMITS } from ${JSON.stringify(here("function-limits.ts"))};

const LONG = ${LONG_FUNCTION};
const HUGE = ${HUGE_FUNCTION};
const span = (name, line, lines) => ({ name, kind: "function", exported: true, line, end_line: line + lines - 1, params: [] });
const members = [
  span("at_long", 10, LONG),
  span("over_long", 100, LONG + 1),
  span("at_huge", 200, HUGE),
  span("over_huge", 300, HUGE + 1),
  span("tiny", 500, 1),
  { name: "bare", kind: "function", exported: true, line: 600, params: [] },
  { name: "K", kind: "constant", exported: true, line: 2, value: "1" },
  { name: "C", kind: "class", exported: true, line: 700, bases: [], fields: [],
    methods: [{ name: "go", line: 710, end_line: 760, params: [], private: false }] },
];
const scan = { modules: [{ id: "p/m.py", kind: "module", members }], edges: [], foreign: [], calls: [] };
const metric = (label, values, extra) => ({ key: "t/" + label, label, granularity: "member", type: "count", bad: "high", overlay: "t", stale: false, max: 100, values, ...extra });
const metrics = [
  metric("complexity", { "p/m.py::at_long": 10, "p/m.py::over_long": 11 }),
  metric("crap", { "p/m.py::at_long": 29, "p/m.py::over_long": 30 }, { type: "number" }),
  metric("coverage", { "p/m.py::at_long": 0.6, "p/m.py::over_long": 0.59 }, { type: "ratio", bad: "low", max: 1 }),
];
const calls = [];
const actions = { open() {}, close() {}, setTab() {}, toggleFold() {}, openFile() {}, hover() {}, putOnCanvas() {}, takeOff() {}, pickName() {}, toggleGroup() {}, setFilter() {}, openInEditor: (target, line) => calls.push([target.id, line ?? null]), setShowPrivate() {} };
const base = {
  scans: [scan], modules: ["p/m.py"], compaction: compactFolders(["p/m.py"]), disc: () => "green", findings: () => [], findingRows: () => [], onCanvas: () => true,
  expanded: new Set(), showPrivate: true, tab: "contents", counts: () => ({ uses: 0, usedBy: 0 }), filter: "", collapsed: new Set(), followed: null,
  responsibility: () => ({ state: { kind: "missing" }, failure: null }), metrics, metricsOn: false, limits: DEFAULT_LIMITS,
};
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const mount = (inputs) => {
  const view = buildInspectorView(actions);
  const host = document.createElement("div");
  host.style.cssText = "width:340px;display:flex;flex-direction:column";
  document.body.append(host);
  host.append(view.element);
  view.render(inspectorContent({ kind: "module", id: "p/m.py" }, inputs), true);
  return view.element;
};
const cardOf = (root, name) => [...root.querySelectorAll(".card")].find((card) => new RegExp("(^|[^A-Za-z_])" + name + "([^A-Za-z_]|$)").test(card.querySelector(".card-code").textContent));
const sizeFacts = (card) => {
  const size = card.querySelector(".card-label .fn-size");
  if (!size) return null;
  const bar = size.querySelector(".fn-bar");
  const fill = bar.querySelector("i");
  return {
    text: size.firstChild.textContent,
    classes: size.className,
    color: getComputedStyle(size).color,
    fillColor: getComputedStyle(fill).backgroundColor,
    fillPercent: Math.round((fill.getBoundingClientRect().width / bar.getBoundingClientRect().width) * 100),
    right: Math.round(card.getBoundingClientRect().right - size.getBoundingClientRect().right),
    inLabel: !!size.closest(".card-label"),
  };
};
const facts = {};
const off = mount(base);
facts.sizes = Object.fromEntries(["at_long", "over_long", "at_huge", "over_huge", "tiny", "bare", "K", "C"].map((name) => [name, sizeFacts(cardOf(off, name))]));
facts.labelLine = Object.fromEntries(["at_long", "K", "C"].map((name) => { const n = cardOf(off, name).querySelector(".card-label .card-line"); return [name, n ? n.textContent : null]; }));
facts.title = cardOf(off, "at_long").title;
facts.constTitle = cardOf(off, "K").title;
facts.metricsOff = off.querySelectorAll(".fn-metrics").length;
facts.oldTable = off.querySelectorAll(".card-function .card-metrics").length;
const methodRow = off.querySelector(".card-member");
facts.methodSize = methodRow.querySelector(".fn-size") ? methodRow.querySelector(".fn-size").firstChild.textContent : null;
facts.methodTitle = methodRow.title;
facts.classSize = off.querySelector(".card-class .card-label .fn-size") ? true : false;
click(cardOf(off, "at_long"));
click(methodRow);
click(cardOf(off, "K"));
facts.calls = calls;

const on = mount({ ...base, metricsOn: true });
const cells = (name) => [...cardOf(on, name).querySelectorAll(".fn-metric")].map((n) => ({ text: n.textContent, classes: n.className, color: getComputedStyle(n.querySelector("b")).color }));
facts.rowOn = { at_long: cells("at_long"), over_long: cells("over_long"), bare: cells("bare") };
facts.rowOnConst = cardOf(on, "K").querySelectorAll(".fn-metrics").length;
facts.neutralColor = getComputedStyle(on.querySelector(".card-code")).color;

document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
`;

type Size = {
  text: string;
  classes: string;
  color: string;
  fillColor: string;
  fillPercent: number;
  right: number;
  inLabel: boolean;
} | null;

type Cell = { text: string; classes: string; color: string };

type Facts = {
  sizes: Record<string, Size>;
  labelLine: Record<string, string | null>;
  title: string;
  constTitle: string;
  metricsOff: number;
  oldTable: number;
  methodSize: string | null;
  methodTitle: string;
  classSize: boolean;
  calls: [string, number | null][];
  rowOn: Record<string, Cell[]>;
  rowOnConst: number;
};

describe.skipIf(webkit === undefined)("function length on a card", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = await collectFacts<Facts>(HARNESS, "member-size-look");
  }, 180000);

  it("bands a function at both edges, using the shared constants", () => {
    expect(f.sizes.at_long?.classes).toBe("fn-size neutral");
    expect(f.sizes.over_long?.classes).toBe("fn-size long");
    expect(f.sizes.at_huge?.classes).toBe("fn-size long");
    expect(f.sizes.over_huge?.classes).toBe("fn-size huge");
    expect(f.sizes.at_long?.text).toBe(`${LONG_FUNCTION} lines`);
    expect(f.sizes.over_huge?.text).toBe(`${HUGE_FUNCTION + 1} lines`);
    expect(f.sizes.tiny?.text).toBe("1 line");
  });

  it("colours the text and the bar by band", () => {
    expect(f.sizes.over_long?.color).not.toBe(f.sizes.at_long?.color);
    expect(f.sizes.over_huge?.color).not.toBe(f.sizes.over_long?.color);
    expect(f.sizes.over_long?.fillColor).not.toBe(f.sizes.at_long?.fillColor);
    expect(f.sizes.over_huge?.fillColor).not.toBe(f.sizes.over_long?.fillColor);
  });

  it("scales the bar against the largest, floors it and keeps it in the track", () => {
    expect(f.sizes.over_huge?.fillPercent).toBe(100);
    expect(f.sizes.at_huge?.fillPercent).toBeLessThan(100);
    expect(f.sizes.tiny?.fillPercent).toBeGreaterThanOrEqual(5);
    expect(f.sizes.tiny?.fillPercent).toBeLessThanOrEqual(7);
  });

  it("puts the size at the top right of the card label", () => {
    expect(f.sizes.over_huge?.inLabel).toBe(true);
    expect(f.sizes.over_huge?.right).toBeGreaterThanOrEqual(0);
    expect(f.sizes.over_huge?.right).toBeLessThan(20);
  });

  it("shows no size for a constant, a class or a function without an end line", () => {
    expect(f.sizes.K).toBeNull();
    expect(f.sizes.C).toBeNull();
    expect(f.sizes.bare).toBeNull();
    expect(f.classSize).toBe(false);
  });

  it("moves a function's start line into its hover text and keeps it on a constant", () => {
    expect(f.labelLine.at_long).toBeNull();
    expect(f.labelLine.K).toBe("2");
    expect(f.title).toBe("Line 10 · click to open in the editor");
    expect(f.constTitle).toBe("Line 2 · click to open in the editor");
  });

  it("gives a method row its length and opens the editor at each clicked line", () => {
    expect(f.methodSize).toBe("51 lines");
    expect(f.methodTitle).toBe("Line 710 · click to open in the editor");
    expect(f.calls).toEqual([
      ["p/m.py", 10],
      ["p/m.py", 710],
      ["p/m.py", 2],
    ]);
  });

  it("draws no metrics row with no metric ticked, and no old table on a function", () => {
    expect(f.metricsOff).toBe(0);
    expect(f.oldTable).toBe(0);
  });

  it("draws complexity, C.R.A.P. and coverage coloured by their limits when a metric is ticked", () => {
    expect(f.rowOn.at_long?.map((cell) => cell.text)).toEqual([
      "cc10",
      "CRAP29",
      "cov60%",
    ]);
    expect(f.rowOn.at_long?.map((cell) => cell.classes)).toEqual([
      "fn-metric",
      "fn-metric",
      "fn-metric",
    ]);
    expect(f.rowOn.over_long?.map((cell) => cell.classes)).toEqual([
      "fn-metric amber",
      "fn-metric red",
      "fn-metric amber",
    ]);
    expect(f.rowOn.over_long?.[0]?.color).not.toBe(f.rowOn.at_long?.[0]?.color);
    expect(f.rowOn.over_long?.[1]?.color).not.toBe(
      f.rowOn.over_long?.[0]?.color,
    );
  });

  it("shows a dash with no tone for a function the overlay does not measure, and no row on a constant", () => {
    expect(f.rowOn.bare?.map((cell) => cell.text)).toEqual([
      "cc-",
      "CRAP-",
      "cov-",
    ]);
    expect(f.rowOn.bare?.every((cell) => cell.classes === "fn-metric")).toBe(
      true,
    );
    expect(f.rowOnConst).toBe(0);
  });
});
