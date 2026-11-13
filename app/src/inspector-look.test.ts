import { describe, expect, it } from "vitest";
import { scaledTimeout } from "../../scripts/pool-scale.mjs";
import { functionLimits } from "./function-limits";
import { collectFacts, here, webkit } from "./look-page";
import { shippedSensors } from "./shipped-fake";

const HOSTS = `<div id="a-rail" style="width:44px;height:300px;display:flex;flex-direction:column"></div><div id="a-panel" style="width:340px;height:600px;display:flex;flex-direction:column"></div><div id="a-long" style="width:340px;height:200px;display:flex;flex-direction:column"></div><div id="a-short" style="width:340px;height:200px;display:flex;flex-direction:column"></div><div id="a-tabs" style="width:340px;height:300px;display:flex;flex-direction:column"></div><div id="a-folder" style="width:340px;height:300px;display:flex;flex-direction:column"></div><div id="a-top" style="width:340px;height:300px;display:flex;flex-direction:column"></div><div id="a-narrow" style="width:200px;height:300px;display:flex;flex-direction:column"></div><div id="a-fit" style="width:340px;height:300px;display:flex;flex-direction:column"></div>`;

const REAL_LIMITS = functionLimits(null, {
  status: "ok",
  sensors: shippedSensors(),
});

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
document.body.insertAdjacentHTML("beforeend", ${JSON.stringify(HOSTS)});
import { buildInspectorView } from ${JSON.stringify(here("inspector-view.ts"))};
import { compactFolders } from ${JSON.stringify(here("folder-compaction.ts"))};
import { inspectorContent } from ${JSON.stringify(here("inspector-model.ts"))};
const DEFAULT_LIMITS = ${JSON.stringify(REAL_LIMITS)};

const scan = {
  modules: [
    { id: "p/m.py", kind: "module", members: [
      { name: "C", kind: "class", exported: true, bases: ["Exception", "Base"], fields: [{ name: "a", type: "int", line: 2, private: false }],
        methods: [{ name: "go", params: [{ name: "x" }], returns: "int" }, { name: "_h", params: [], private: true }] },
      { name: "f", kind: "function", exported: true, params: [] },
      { name: "_g", kind: "function", exported: false, params: [] },
    ] },
    { id: "p/o.py", kind: "module" },
    { id: "p/q.py", kind: "module", members: [{ name: "Z", kind: "class", exported: true }] },
    { id: "deep/folder/" + "n".repeat(120) + ".py", kind: "module" },
  ],
  edges: [],
  foreign: [],
  calls: [{ from: "p/o.py::x", to: "p/m.py::C.go", line: 1, how: "call" }],
};
const inputs = {
  scans: [scan],
  modules: scan.modules.map((m) => m.id),
  compaction: compactFolders(scan.modules.map((m) => m.id)),
  disc: () => "green",
  findings: () => [],
  onCanvas: (id) => id === "p/m.py",
  expanded: new Set(),
  showPrivate: true,
  tab: "contents",
  counts: () => ({ uses: 0, usedBy: 0 }),
  noteRows: () => [],
  canAddNote: false,
  filter: "",
  responsibility: () => ({ state: { kind: "missing" }, failure: null }),
  metricsOn: false,
  limits: DEFAULT_LIMITS,
  metrics: [
    { key: "t/complexity", label: "complexity", short: "cc", title: "Complexity", granularity: "member", type: "count", bad: "high", overlay: "t", stale: false, max: 12, values: { "p/m.py::C.go": 12, "p/m.py::f": 1 } },
    { key: "t/coverage", label: "coverage", short: "cov", title: "Coverage", granularity: "member", type: "ratio", bad: "low", overlay: "t", stale: false, max: 1, values: { "p/m.py::C.go": 0.5 } },
  ],
};
const actions = { open() {}, close() {}, setTab() {}, toggleFold() {}, openFile() {}, hover() {}, putOnCanvas() {}, takeOff() {}, pickName() {}, setFilter() {}, openInEditor() {}, setShowPrivate() {} };
const mount = (id, selection, open) => {
  const view = buildInspectorView(actions);
  view.render(inspectorContent(selection, inputs), open);
  const host = document.getElementById(id);
  host.append(view.element);
};
mount("a-rail", { kind: "module", id: "p/m.py" }, false);
mount("a-panel", { kind: "module", id: "p/m.py" }, true);
mount("a-long", { kind: "module", id: "deep/folder/" + "n".repeat(120) + ".py" }, true);
mount("a-short", { kind: "module", id: "p/q.py" }, true);
const counted = { ...inputs, counts: () => ({ uses: 1000, usedBy: 114 }), findings: () => Array.from({ length: 49 }, () => ({ severity: "warning" })), responsibility: () => ({ state: { kind: "out-of-date", line: "Does the thing.", reasons: ["describer"] }, failure: null }) };
const mountCounted = (id, selection) => {
  const view = buildInspectorView(actions);
  view.render(inspectorContent(selection, counted), true);
  document.getElementById(id).append(view.element);
};
mountCounted("a-tabs", { kind: "module", id: "p/m.py" });
mountCounted("a-folder", { kind: "folder", id: "deep/folder" });
mountCounted("a-top", { kind: "folder", id: "p" });
mountCounted("a-narrow", { kind: "module", id: "p/m.py" });
mountCounted("a-fit", { kind: "module", id: "p/m.py" });
const measureTabs = (id) => {
  const row = document.querySelector("#" + id + " .itabs");
  const buttons = [...row.querySelectorAll("button")];
  return {
    rowHeight: row.getBoundingClientRect().height,
    heights: buttons.map((b) => b.getBoundingClientRect().height),
    labels: buttons.map((b) => b.textContent),
    nowrap: buttons.map((b) => getComputedStyle(b).whiteSpace),
    tabular: buttons.map((b) => { const n = b.querySelector(".n"); return n ? getComputedStyle(n).fontVariantNumeric : null; }),
    scrollWidth: row.scrollWidth,
    clientWidth: row.clientWidth,
  };
};
const measureFit = () => {
  const host = document.getElementById("a-fit");
  const row = host.querySelector(".itabs");
  host.style.width = "1200px";
  const natural = row.scrollWidth - 24;
  host.style.width = natural + "px";
  return measureTabs("a-fit");
};
const measureShape = (id) => {
  const root = document.querySelector("#" + id);
  const disc = root.querySelector(".ih .disc").getBoundingClientRect();
  const name = root.querySelector(".ih-name").getBoundingClientRect();
  const line = root.querySelector(".responsibility .line");
  return {
    discTop: disc.top,
    discBottom: disc.bottom,
    nameTop: name.top,
    nameBottom: name.bottom,
    nameLeft: name.left,
    lineLeft: line ? line.getBoundingClientRect().left : null,
    muted: root.querySelector(".ih-folder").textContent,
    tags: root.querySelectorAll(".responsibility .tag").length,
    describe: root.querySelectorAll("button.describe").length,
    nameSize: getComputedStyle(root.querySelector(".ih-name")).fontSize,
    nameWeight: getComputedStyle(root.querySelector(".ih-name")).fontWeight,
    folderSize: getComputedStyle(root.querySelector(".ih-folder")).fontSize,
  };
};
const BOX = ["padding-top", "padding-right", "padding-bottom", "padding-left"];
const BORDER_L = ["border-left-width", "border-left-color"];
const ROW = ["display", "column-gap", "align-items", "color", "font-size", "font-weight", "border-top-left-radius", ...BOX];
const specs = {
  rail: ["#a-rail .inspector-rail", ["width", "display", "flex-direction", "align-items", "background-color", "box-sizing", "padding-top", ...BORDER_L]],
  railButton: ["#a-rail .inspector-rail .ib", ["width", "height", "color", "background-color", "border-top-left-radius"]],
  panel: ["#a-panel .inspector-panel", ["width", "box-sizing", "background-color", "overflow-x", "overflow-y", ...BOX, ...BORDER_L]],
  close: ["#a-panel .ih .ib", ["width", "height", "color", "border-top-left-radius", "background-color"]],
  tabs: ["#a-panel .itabs", ["display", "column-gap", "margin-bottom", "border-bottom-width", "border-bottom-color"]],
  tabOn: ["#a-panel .itabs button.on", ["padding-top", "padding-left", "color", "font-weight", "font-size", "box-shadow", "background-color"]],
  tabOff: ["#a-panel .itabs button:not(.on)", ["padding-top", "padding-left", "color", "font-weight", "font-size", "box-shadow", "background-color"]],
};
const read = (node, props) => {
  if (!node) return { missing: true };
  const style = getComputedStyle(node);
  return Object.fromEntries(props.map((p) => [p, style.getPropertyValue(p)]));
};
const app = {};
for (const [name, [a, props]] of Object.entries(specs)) {
  app[name] = read(document.querySelector(a), props);
}
const panel = document.querySelector("#a-panel");
const measureHead = (id) => {
  const text = document.querySelector("#" + id + " .ih-text");
  const [name, folder] = [text.querySelector("b"), text.querySelector(".muted")];
  const line = parseFloat(getComputedStyle(name).lineHeight) || name.getBoundingClientRect().height;
  return {
    nameHeight: name.getBoundingClientRect().height,
    nameScroll: name.scrollWidth,
    nameClient: name.clientWidth,
    overflow: getComputedStyle(name).textOverflow,
    nameTitle: name.title,
    nameText: name.textContent,
    nameBottom: name.getBoundingClientRect().bottom,
    folderTop: folder ? folder.getBoundingClientRect().top : null,
    folderTitle: folder ? folder.title : null,
    folderText: folder ? folder.textContent : null,
    lines: text.querySelectorAll(":scope > *").length,
    closeRight: document.querySelector("#" + id + " .ih .ib").getBoundingClientRect().right,
    panelRight: document.querySelector("#" + id + " .inspector-panel").getBoundingClientRect().right,
    line,
  };
};
const result = {
  app,
  structure: {
    images: document.querySelectorAll(".inspector img").length,
    iconFonts: document.querySelectorAll(".inspector i").length,
    railSvgs: document.querySelectorAll("#a-rail .inspector-rail svg").length,
    railPath: [...document.querySelectorAll("#a-rail svg path")].map((n) => n.getAttribute("d")),
  },
  heads: { long: measureHead("a-long"), short: measureHead("a-short") },
  tabsRow: { default: measureTabs("a-tabs"), narrow: measureTabs("a-narrow"), fit: measureFit(), folder: measureTabs("a-folder") },
  shapes: { module: measureShape("a-tabs"), folder: measureShape("a-folder"), top: measureShape("a-top") },
  links: document.querySelectorAll("#a-panel .cb").length,
  tables: [...panel.querySelectorAll(".card")].map((card) => {
    const table = card.querySelector(".card-metrics");
    if (!table) return null;
    const cells = [...table.querySelectorAll("td.metrics-cell")];
    return {
      kind: card.querySelector(".card-kind").textContent,
      head: [...table.querySelectorAll("th.metrics-cell")].map((n) => n.textContent),
      names: [...table.querySelectorAll("td.metrics-name")].map((n) => n.textContent),
      rows: table.querySelectorAll("tr.metrics-row").length,
      text: cells.map((n) => n.textContent),
      titles: cells.map((n) => n.title),
      align: cells.map((n) => getComputedStyle(n).textAlign),
      mono: cells.map((n) => /mono|Menlo/i.test(getComputedStyle(n).fontFamily)),
      colors: cells.map((n) => getComputedStyle(n).color),
      header: panel.querySelector(".ih").querySelectorAll(".card-metrics").length,
    };
  }),
  linkText: [...panel.querySelectorAll(".card")].map((n) => n.textContent).filter((t) => /(called|built|used) by/.test(t)).length,
};
window.addEventListener("load", () => {
  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(result))));
});`;

type TabsFacts = {
  rowHeight: number;
  heights: number[];
  labels: string[];
  nowrap: string[];
  tabular: (string | null)[];
  scrollWidth: number;
  clientWidth: number;
};
type ShapeFacts = {
  discTop: number;
  discBottom: number;
  nameTop: number;
  nameBottom: number;
  nameLeft: number;
  lineLeft: number | null;
  muted: string;
  tags: number;
  describe: number;
  nameSize: string;
  nameWeight: string;
  folderSize: string;
};

type Styles = Record<string, Record<string, string | boolean>>;
type Report = {
  app: Styles;
  structure: {
    images: number;
    iconFonts: number;
    railSvgs: number;
    railPath: string[];
  };
  heads: Record<string, Record<string, number | string | null>>;
  tabsRow: Record<string, TabsFacts>;
  shapes: Record<string, ShapeFacts>;
  links: number;
  linkText: number;
  tables: ({
    kind: string;
    head: string[];
    names: string[];
    rows: number;
    text: string[];
    titles: string[];
    align: string[];
    mono: boolean[];
    colors: string[];
    header: number;
  } | null)[];
};

const EXPECTED: Styles = {
  rail: {
    width: "44px",
    display: "flex",
    "flex-direction": "column",
    "align-items": "center",
    "background-color": "rgb(31, 35, 40)",
    "box-sizing": "border-box",
    "padding-top": "12px",
    "border-left-width": "1px",
    "border-left-color": "rgb(48, 54, 61)",
  },
  railButton: {
    width: "32px",
    height: "32px",
    color: "rgb(145, 152, 161)",
    "background-color": "rgba(0, 0, 0, 0)",
    "border-top-left-radius": "4px",
  },
  panel: {
    width: "340px",
    "box-sizing": "border-box",
    "background-color": "rgb(31, 35, 40)",
    "overflow-x": "auto",
    "overflow-y": "auto",
    "padding-top": "12px",
    "padding-right": "12px",
    "padding-bottom": "12px",
    "padding-left": "12px",
    "border-left-width": "1px",
    "border-left-color": "rgb(48, 54, 61)",
  },
  close: {
    width: "22px",
    height: "22px",
    color: "rgb(145, 152, 161)",
    "border-top-left-radius": "4px",
    "background-color": "rgba(0, 0, 0, 0)",
  },
  tabs: {
    display: "flex",
    "column-gap": "0px",
    "margin-bottom": "8px",
    "border-bottom-width": "1px",
    "border-bottom-color": "rgb(48, 54, 61)",
  },
  tabOn: {
    "padding-top": "6px",
    "padding-left": "10px",
    color: "rgb(230, 237, 243)",
    "font-weight": "600",
    "font-size": "12px",
    "box-shadow": "rgb(68, 147, 248) 0px -2px 0px 0px inset",
    "background-color": "rgba(0, 0, 0, 0)",
  },
  tabOff: {
    "padding-top": "6px",
    "padding-left": "10px",
    color: "rgb(145, 152, 161)",
    "font-weight": "400",
    "font-size": "12px",
    "box-shadow": "none",
    "background-color": "rgba(0, 0, 0, 0)",
  },
};

async function prepare(): Promise<Report> {
  return collectFacts<Report>(HARNESS, "inspector-look", "bare");
}

describe("the inspector, in a real browser", () => {
  it.skipIf(webkit === undefined)(
    "computes the designed styles",
    async () => {
      const report = await prepare();

      for (const name of Object.keys(EXPECTED)) {
        expect(report.app[name]).not.toHaveProperty("missing");
        expect({ [name]: report.app[name] }).toEqual({
          [name]: EXPECTED[name],
        });
      }
    },
    scaledTimeout(120000),
  );

  it.skipIf(webkit === undefined)(
    "cuts a long name to one line with an ellipsis and puts the folder below",
    async () => {
      const { heads } = await prepare();
      const long = heads.long as Record<string, number | string>;
      const short = heads.short as Record<string, number | string>;

      expect(long.nameHeight).toBeCloseTo(long.line as number, 1);
      expect(long.nameScroll as number).toBeGreaterThan(
        long.nameClient as number,
      );
      expect(long.overflow).toBe("ellipsis");
      expect(long.nameTitle).toBe(long.nameText);
      expect((long.nameTitle as string).length).toBe(123);
      expect(long.folderTop as number).toBeGreaterThanOrEqual(
        long.nameBottom as number,
      );
      expect(long.folderTitle).toBe(long.folderText);
      expect(long.closeRight as number).toBeLessThanOrEqual(
        long.panelRight as number,
      );
      expect(short.nameScroll).toBe(short.nameClient);
    },
    scaledTimeout(180000),
  );

  it.skipIf(webkit === undefined)(
    "keeps the tab row to one line with three counted tabs, scrolling sideways when narrow",
    async () => {
      const { tabsRow } = await prepare();

      for (const name of ["default", "folder"]) {
        const row = tabsRow[name];

        expect(row.labels).toEqual([
          "Contents",
          "Dependencies 1114",
          "Findings 49",
        ]);
        expect(new Set(row.heights).size).toBe(1);
        expect(row.rowHeight).toBeLessThanOrEqual(row.heights[0] + 2);
        expect(row.nowrap.every((value) => value === "nowrap")).toBe(true);
        expect(row.tabular.slice(1)).toEqual(["tabular-nums", "tabular-nums"]);
      }

      expect(tabsRow.narrow.rowHeight).toBe(tabsRow.default.rowHeight);
      expect(tabsRow.narrow.scrollWidth).toBeGreaterThan(
        tabsRow.narrow.clientWidth,
      );
      expect(tabsRow.fit.scrollWidth).toBeLessThanOrEqual(
        tabsRow.fit.clientWidth,
      );
    },
    scaledTimeout(180000),
  );

  it.skipIf(webkit === undefined)(
    "gives a folder and a module one header shape with the sentence under the name",
    async () => {
      const { shapes } = await prepare();

      for (const name of ["module", "folder", "top"]) {
        const shape = shapes[name];

        expect(shape.nameSize).toBe("14px");
        expect(shape.nameWeight).toBe("600");
        expect(shape.folderSize).toBe("12px");
        expect(shape.discTop).toBeGreaterThanOrEqual(shape.nameTop - 1);
        expect(shape.discBottom).toBeLessThanOrEqual(shape.nameBottom + 1);
      }

      expect(shapes.module.lineLeft).toBe(shapes.module.nameLeft);
      expect(shapes.module.tags).toBe(0);
      expect(shapes.module.describe).toBe(0);
      expect(shapes.module.muted).toBe("p/");
      expect(shapes.folder.muted).toBe("1 files · deep/");
      expect(shapes.top.muted).toBe("3 files");
    },
    scaledTimeout(180000),
  );

  it.skipIf(webkit === undefined)(
    "shows no links to other modules in Contents",
    async () => {
      const report = await prepare();

      expect(report.links).toBe(0);
      expect(report.linkText).toBe(0);
    },
    scaledTimeout(180000),
  );

  it.skipIf(webkit === undefined)(
    "shows a metric table at the foot of the class card, none on a function card and none in the header",
    async () => {
      const { tables } = await prepare();
      const klass = tables.find((table) => table?.kind === "Class");
      const func = tables.find((table) => table?.kind === "Function");

      expect(klass?.head).toEqual(["cc", "cov"]);
      expect(klass?.names).toEqual(["go", "_h"]);
      expect(klass?.rows).toBe(2);
      expect(klass?.text).toEqual(["12", "50%", "-", "-"]);
      expect(klass?.titles).toEqual([
        "Complexity 12",
        "Coverage 50%",
        "Complexity: not measured",
        "Coverage: not measured",
      ]);
      expect(klass?.align).toEqual(["right", "right", "right", "right"]);
      expect(klass?.mono.every(Boolean)).toBe(true);
      expect(klass?.colors[0]).not.toBe(klass?.colors[2]);
      expect(klass?.header).toBe(0);
      expect(func).toBeUndefined();
    },
    scaledTimeout(180000),
  );

  it.skipIf(webkit === undefined)(
    "draws every icon as one inline svg and uses no images or icon fonts",
    async () => {
      const { structure } = await prepare();

      expect(structure.images).toBe(0);
      expect(structure.iconFonts).toBe(0);
      expect(structure.railSvgs).toBe(1);
      expect(structure.railPath).toContain("M15 4v16");
    },
    scaledTimeout(180000),
  );
});
