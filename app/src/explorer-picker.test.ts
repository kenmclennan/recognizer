import { beforeAll, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../scripts/pool-scale.mjs";
import { collectFacts, here, webkit } from "./look-page";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { loadedOf, mountExplorer } from ${JSON.stringify(here("look-support.ts"))};

let layouts = 0;
window.__fakeWorker = () => {
  const listeners = [];
  return {
    addEventListener: (type, listener) => listeners.push(listener),
    postMessage(request) {
      if (request.cmd !== "layout") return;
      layouts += 1;
      let row = 0;
      const place = (node, depth) => {
        for (const child of node.children || []) {
          child.x = 10 + depth * 20 + (row % 3) * 200;
          child.y = 40 + row * 70;
          row += 1;
          place(child, depth + 1);
        }
      };
      const graph = JSON.parse(JSON.stringify(request.graph));
      place(graph, 0);
      for (const listener of listeners) listener({ data: { id: request.id, data: graph } });
    },
  };
};

const edge = (to, names) => ({ from: "app/hub.py", to, kind: "depends", line: 1, names });
const scan = {
  modules: ["app/hub.py", "app/a.py", "lib/c.py", "lib/d.py", "lib/e.py"].map((id) => ({ id, kind: "module" })),
  edges: [edge("app/a.py", ["A"]), edge("lib/c.py", ["C"]), edge("lib/d.py", ["D"]), edge("lib/e.py", ["E"])],
  foreign: [],
};
const loaded = loadedOf({ modules: scan.modules.map((m) => m.id), scans: [{ file: "scan.json", scan }] });

const app = document.getElementById("app");
mountExplorer({ container: app, loaded, title: "demo", onCount: (text) => { document.getElementById("module-count").textContent = text; } });

const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const key = (k) => document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
const cs = (node) => getComputedStyle(node);
const treeRow = (p) => document.querySelector('.tree .row[data-path="' + p + '"]');
const pickRow = (id) => document.querySelector('.inspector-panel .row[data-id="' + id + '"]');
const count = () => document.getElementById("module-count").textContent;
const aria = (row) => row.querySelector(".reye").getAttribute("aria-pressed");
const folderLabel = (key) => document.querySelector('.inspector-panel .dep-folder[data-id="' + key + '"]');
const centre = (node) => { const r = node.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
const off = (id) => { const c = centre(document.querySelector('.box[data-id="' + id + '"]')); const s = centre(document.querySelector(".stage")); return Math.hypot(c.x - s.x, c.y - s.y); };
const selected = () => [...document.querySelectorAll(".box.selected")].map((n) => n.dataset.id);
const bar = (label) => document.querySelector('.selection-bar [aria-label^="' + label + '"]');
const heads = () => [...document.querySelectorAll(".inspector-panel .dep-head")];
const sectionRows = () => document.querySelectorAll(".inspector-panel .row.file").length;
const look = (node) => { const c = cs(node.querySelector(".reye")); return [c.width, c.height, c.color].join("|"); };
const tabs = () => [...document.querySelectorAll(".inspector-panel .itabs button")];
const facts = {};

click(treeRow("app").querySelector(".name"));
click(treeRow("lib").querySelector(".name"));
click(treeRow("app/hub.py").querySelector(".reye"));
facts.afterHub = count();
click(document.querySelector('.box[data-id="app/hub.py"] .box-body'));
facts.selectedHub = selected();
click(bar("Dependencies"));
facts.tabs = tabs().map((t) => t.textContent);
facts.activeTab = tabs().filter((t) => t.classList.contains("on")).map((t) => t.textContent);
facts.barLit = bar("Dependencies").classList.contains("on");
facts.barFigure = bar("Dependencies").textContent;
click(bar("Dependencies"));
facts.stillShown = document.querySelector(".inspector-panel .itabs button.on").textContent;
key("d");
facts.afterD = [document.querySelector(".inspector-panel .itabs button.on").textContent, bar("Dependencies").disabled, bar("Dependencies").classList.contains("on")];
key("u");
facts.afterU = document.querySelector(".inspector-panel .itabs button.on").textContent;
facts.sections = heads().map((h) => ({ label: h.querySelector(".dep-label").textContent, count: h.querySelector(".dep-count").textContent, caption: h.querySelector(".dep-caption").textContent, icon: h.querySelector("svg path").getAttribute("d") }));
facts.openRows = sectionRows();
click(heads()[0]);
const panelChevrons = () => document.querySelectorAll(".inspector-panel svg.chevron").length;
facts.afterHeadClick = { heads: heads().map((h) => h.querySelector(".dep-label").textContent + " " + h.querySelector(".dep-count").textContent), rows: sectionRows(), chevrons: panelChevrons() };
click(document.querySelector(".inspector-panel .dep-folder .dep-path"));
facts.afterGroupClick = { rows: sectionRows(), chevrons: panelChevrons() };
facts.iconTitles = [...document.querySelectorAll("button")].filter((b) => b.querySelector("svg.i") && !b.classList.contains("reye")).map((b) => b.title || b.getAttribute("data-label") || "");
facts.barText = [...document.querySelectorAll(".selection-bar button")].map((b) => b.textContent);

facts.groupHeads = [...document.querySelectorAll(".inspector-panel .dep-folder .dep-path")].map((r) => r.textContent);
facts.labelParts = [...document.querySelectorAll(".inspector-panel .dep-folder")].map((n) => ({ rcheck: n.querySelectorAll(".rcheck").length, eye: n.querySelectorAll(".reye").length, disc: n.querySelectorAll(".disc").length, detail: n.querySelectorAll(".detail").length, icon: n.querySelector("svg") !== null, all: n.querySelector(".dep-all").textContent, own: n.classList.contains("own") }));
facts.panelRowHead = { legends: document.querySelectorAll(".inspector-panel .dep-legend").length, titles: document.querySelectorAll(".inspector-panel .dep-panel .row[title], .inspector-panel .dep-panel .dep-folder[title], .inspector-panel .dep-panel .disc[title]").length, expanded: document.querySelectorAll(".inspector-panel .dep-panel .row .detail, .inspector-panel .dep-panel .row.open").length };
pickRow("lib/c.py").dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
facts.tip = { count: document.querySelectorAll(".module-tip").length, path: document.querySelector(".module-tip .module-tip-path")?.textContent };
pickRow("lib/c.py").dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
facts.pickOrder = [...pickRow("lib/c.py").children].map((c) => c.classList.contains("reye") ? "eye" : c.classList.contains("name") ? "name" : c.classList.contains("disc") ? "disc" : c.classList.contains("detail") ? "detail" : "other");
facts.beforeC = { tree: aria(treeRow("lib/c.py")), pick: aria(pickRow("lib/c.py")) };
const layoutsBefore = layouts;
click(pickRow("lib/c.py").querySelector(".name"));
facts.nameOnUnchecked = {
  count: count(),
  tree: aria(treeRow("lib/c.py")),
  pick: aria(pickRow("lib/c.py")),
  selected: selected(),
  off: off("lib/c.py"),
  layouts: layouts - layoutsBefore,
};
const layoutsMid = layouts;
click(pickRow("lib/c.py").querySelector(".name"));
facts.nameOnChecked = { count: count(), off: off("lib/c.py"), layouts: layouts - layoutsMid };
facts.groupPartial = aria(treeRow("lib"));
{
  const hubOff = off("app/hub.py");
  const hubSelected = selected();
  click(pickRow("lib/e.py").querySelector(".reye"));
  facts.eyeInPanel = { count: count(), selected: selected(), hubMoved: Math.abs(off("app/hub.py") - hubOff), hubSelected, state: aria(pickRow("lib/e.py")), tree: aria(treeRow("lib/e.py")) };
  click(pickRow("lib/e.py").querySelector(".reye"));
  facts.eyeInPanelBack = { count: count(), selected: selected() };
}
facts.looks = {
  checked: [look(treeRow("lib/c.py")), look(pickRow("lib/c.py"))],
  unchecked: [look(treeRow("lib/d.py")), look(pickRow("lib/d.py"))],
  partial: [look(treeRow("lib")), look(treeRow("lib"))],
};
facts.looks.checkedBg = cs(pickRow("lib/c.py").querySelector(".reye")).color;
facts.looks.uncheckedBg = cs(pickRow("lib/d.py").querySelector(".reye")).color;
const layoutsGroup = layouts;
click(folderLabel("lib").querySelector(".dep-all"));
facts.groupOn = { count: count(), state: aria(treeRow("lib")), layouts: layouts - layoutsGroup, rows: ["lib/c.py", "lib/d.py", "lib/e.py"].map((id) => aria(pickRow(id))), selected: selected() };
const layoutsAgain = layouts;
click(folderLabel("lib").querySelector(".dep-all"));
facts.showAllAgain = { count: count(), layouts: layouts - layoutsAgain };
click(pickRow("lib/d.py").querySelector(".reye"));
facts.untick = { count: count(), tree: aria(treeRow("lib/d.py")), group: aria(treeRow("lib")) };
const layoutsFolder = layouts;
click(treeRow("lib").querySelector(".reye"));
facts.treeFolderPartialClick = { count: count(), state: aria(treeRow("lib")), layouts: layouts - layoutsFolder };
click(treeRow("lib").querySelector(".reye"));
facts.treeFolderCheckedClick = { count: count(), state: aria(treeRow("lib")) };
click(treeRow("lib").querySelector(".name"));
facts.folderNameToggled = treeRow("lib/c.py") === null;

facts.tabStyle = tabs().filter((t) => !t.classList.contains("on")).map((t) => { const c = cs(t); return [c.paddingTop, c.paddingLeft, c.fontSize, c.fontWeight, c.color, c.boxShadow, c.borderTopWidth].join("|"); });
facts.activeTabStyle = (() => { const c = cs(document.querySelector(".inspector-panel .itabs button.on")); return [c.fontWeight, c.boxShadow].join("|"); })();
facts.absent = {
  picker: document.querySelectorAll('[class*="picker"]').length,
  ghost: document.querySelectorAll('[class*="ghost"], [data-kind="ghost"]').length,
  platformCheckbox: document.querySelectorAll('.tree input[type="checkbox"]:not(.scan-tick), .inspector-panel input[type="checkbox"]').length,
  rowButtons: document.querySelectorAll(".tree .row button:not(.reye), .inspector-panel .row button:not(.reye)").length,
  labels: [...document.querySelectorAll("button, [aria-label]")].filter((n) => !n.closest(".notes-panel")).map((n) => (n.getAttribute("aria-label") || "") + "|" + n.textContent).filter((t) => /Find on canvas|Put on the canvas|Tick all|By name|By module|^\\|Add/.test(t)),
  legend: document.querySelector(".tree .legend"),
};
facts.absent.legend = facts.absent.legend === null;

const before = count();
key("Backspace");
facts.backspace = { before, after: count(), selected: selected() };

const takeOffButton = () => document.querySelector('.selection-bar [aria-label="Take off the canvas (Backspace)"]');
click(treeRow("app/a.py").querySelector(".reye"));
click(document.querySelector('.box[data-id="app/a.py"] .box-body'));
const moduleBefore = count();
click(takeOffButton());
facts.takeOffModule = { before: moduleBefore, after: count(), selected: selected() };
click(treeRow("lib").querySelector(".reye"));
click(document.querySelector('.frame-label[data-id="lib"]'));
const folderBefore = count();
const folderBar = [...document.querySelectorAll(".selection-bar > *")].map((n) => n.classList.contains("bar-sep") ? "|" : n.getAttribute("aria-label") || n.textContent);
facts.takeOffFolder = { bar: folderBar.slice(-2), title: takeOffButton().title, cross: takeOffButton().querySelector("path[d*='M18 6L6 18']") !== null, before: folderBefore };
click(takeOffButton());
facts.takeOffFolder.after = count();

click(treeRow("app/hub.py").querySelector(".reye"));
click(document.querySelector('.box[data-id="app/hub.py"] .box-body'));
facts.hideSelectedBefore = selected();
click(treeRow("app/hub.py").querySelector(".reye"));
facts.hideSelected = { selected: selected(), tree: aria(treeRow("app/hub.py")), box: document.querySelector('.box[data-id="app/hub.py"]') === null };

document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
`;

type Facts = {
  afterHub: string;
  selectedHub: string[];
  tabs: string[];
  activeTab: string[];
  barLit: boolean;
  stillShown: string;
  afterD: [string, boolean, boolean];
  barFigure: string;
  sections: { label: string; count: string; caption: string; icon: string }[];
  openRows: number;
  afterHeadClick: { heads: string[]; rows: number; chevrons: number };
  afterGroupClick: { rows: number; chevrons: number };
  iconTitles: string[];
  barText: string[];
  afterU: string;
  groupHeads: string[];
  labelParts: {
    rcheck: number;
    eye: number;
    disc: number;
    detail: number;
    icon: boolean;
    all: string;
    own: boolean;
  }[];
  panelRowHead: {
    legends: number;
    titles: number;
    expanded: number;
  };
  tip: { count: number; path: string | undefined };
  eyeInPanel: {
    count: string;
    selected: string[];
    hubMoved: number;
    hubSelected: string[];
    state: string;
    tree: string;
  };
  eyeInPanelBack: { count: string; selected: string[] };
  showAllAgain: { count: string; layouts: number };
  hideSelectedBefore: string[];
  hideSelected: { selected: string[]; tree: string; box: boolean };
  pickOrder: string[];
  beforeC: { tree: string; pick: string };
  nameOnUnchecked: {
    count: string;
    tree: string;
    pick: string;
    selected: string[];
    off: number;
    layouts: number;
  };
  nameOnChecked: { count: string; off: number; layouts: number };
  groupPartial: string;
  looks: {
    checked: string[];
    unchecked: string[];
    partial: string[];
    checkedBg: string;
    uncheckedBg: string;
  };
  groupOn: {
    count: string;
    state: string;
    layouts: number;
    rows: string[];
    selected: string[];
  };
  untick: { count: string; tree: string; group: string };
  treeFolderPartialClick: { count: string; state: string; layouts: number };
  treeFolderCheckedClick: { count: string; state: string };
  folderNameToggled: boolean;
  tabStyle: string[];
  activeTabStyle: string;
  absent: {
    picker: number;
    ghost: number;
    platformCheckbox: number;
    rowButtons: number;
    labels: string[];
    legend: boolean;
  };
  backspace: { before: string; after: string; selected: string[] };
  takeOffModule: { before: string; after: string; selected: string[] };
  takeOffFolder: {
    bar: string[];
    title: string;
    cross: boolean;
    before: string;
    after: string;
  };
};

async function collect(): Promise<Facts> {
  return collectFacts<Facts>(HARNESS, "explorer-picker", "app");
}

describe.skipIf(webkit === undefined)("the picker as inspector tabs", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = await collect();
  }, scaledTimeout(120000));

  it("opens Dependencies as the third inspector tab, lit on the bar with the total, and stays on a second press", () => {
    expect(f.tabs).toEqual(["Contents", "Dependencies 4", "Findings"]);
    expect(f.activeTab).toEqual(["Dependencies 4"]);
    expect(f.barLit).toBe(true);
    expect(f.barFigure).toBe("4");
    expect(f.stillShown).toBe("Dependencies 4");
  });

  it("maps D to the Dependencies tab and does nothing for U", () => {
    expect(f.afterD).toEqual(["Dependencies 4", false, true]);
    expect(f.afterU).toBe("Dependencies 4");
  });

  it("lists a Uses and a Used by heading with their counts, always open, with folder groups that never fold", () => {
    expect(f.sections.map((x) => `${x.label} ${x.count}`)).toEqual([
      "Uses 4",
      "Used by 0",
    ]);
    expect(f.sections.map((x) => x.caption)).toEqual([
      "hub.py imports these",
      "these import hub.py",
    ]);
    expect(f.sections[0].icon).toBe("M5 12h14M13 6l6 6-6 6");
    expect(f.sections[1].icon).toBe("M19 12H5");
    expect(f.openRows).toBe(4);
    expect(f.afterHeadClick).toEqual({
      heads: ["Uses 4", "Used by 0"],
      rows: 4,
      chevrons: 0,
    });
    expect(f.afterGroupClick).toEqual({ rows: 4, chevrons: 0 });
  });

  it("gives every icon button a tooltip and no bar button a word", () => {
    expect(f.iconTitles.length).toBeGreaterThan(0);
    expect(f.iconTitles.every((title) => title !== "")).toBe(true);

    for (const text of f.barText) {
      expect(text).toMatch(/^(\d+(\/\d+)?)?$/);
    }
  });

  it("groups by folder with quiet labels and one row each: disc, name, eye", () => {
    expect(f.groupHeads).toEqual(["this folder", "lib/"]);
    expect(f.pickOrder).toEqual(["disc", "name", "eye"]);
    expect(f.labelParts).toEqual([
      {
        rcheck: 0,
        eye: 0,
        disc: 0,
        detail: 0,
        icon: true,
        all: "Show all 1",
        own: true,
      },
      {
        rcheck: 0,
        eye: 0,
        disc: 0,
        detail: 0,
        icon: true,
        all: "Show all 3",
        own: false,
      },
    ]);
  });

  it("has no legend row, no title attribute and no row expansion, and one module tip on hover", () => {
    expect(f.panelRowHead).toEqual({
      legends: 0,
      titles: 0,
      expanded: 0,
    });
    expect(f.tip).toEqual({ count: 1, path: "lib/c.py" });
  });

  it("clicking an eye in a panel toggles presence without selecting or centring", () => {
    expect(f.eyeInPanel.count).toBe("3 of 5 modules on the canvas");
    expect(f.eyeInPanel.state).toBe("true");
    expect(f.eyeInPanel.tree).toBe("true");
    expect(f.eyeInPanel.selected).toEqual(f.eyeInPanel.hubSelected);
    expect(f.eyeInPanel.hubMoved).toBeLessThan(1);
    expect(f.eyeInPanelBack.count).toBe("2 of 5 modules on the canvas");
    expect(f.eyeInPanelBack.selected).toEqual(f.eyeInPanel.hubSelected);
  });

  it("hides the selected module from the tree's eye and clears the selection", () => {
    expect(f.hideSelectedBefore).toEqual(["app/hub.py"]);
    expect(f.hideSelected).toEqual({ selected: [], tree: "false", box: true });
  });

  it("Show all N puts a group on and does nothing when all are on", () => {
    expect(f.groupOn.selected).toEqual(f.eyeInPanel.hubSelected);
    expect(f.showAllAgain).toEqual({
      count: "4 of 5 modules on the canvas",
      layouts: 0,
    });
  });

  it("clicking an unchecked name puts it on, ticks it in the tree and Dependencies, centres on its box and keeps the selection", () => {
    expect(f.beforeC).toEqual({ tree: "false", pick: "false" });
    expect(f.nameOnUnchecked.count).toBe("2 of 5 modules on the canvas");
    expect(f.nameOnUnchecked.tree).toBe("true");
    expect(f.nameOnUnchecked.pick).toBe("true");
    expect(f.nameOnUnchecked.selected).toEqual(["app/hub.py"]);
    expect(f.nameOnUnchecked.off).toBeLessThan(2);
  });

  it("clicking a checked name centres without changing the canvas", () => {
    expect(f.nameOnChecked.count).toBe("2 of 5 modules on the canvas");
    expect(f.nameOnChecked.layouts).toBe(0);
    expect(f.nameOnChecked.off).toBeLessThan(2);
  });

  it("draws the eye with the same computed look in the tree and the tab, in each state", () => {
    expect(f.groupPartial).toBe("mixed");
    expect(f.looks.checked[0]).toBe(f.looks.checked[1]);
    expect(f.looks.unchecked[0]).toBe(f.looks.unchecked[1]);
    expect(f.looks.partial[0]).toBe(f.looks.partial[1]);
    expect(f.looks.checkedBg).not.toBe(f.looks.uncheckedBg);
    expect(f.looks.partial[0]).toBe(f.looks.checked[0]);
  });

  it("puts every file of a group on with one layout, and unticking takes one off", () => {
    expect(f.groupOn.count).toBe("4 of 5 modules on the canvas");
    expect(f.groupOn.state).toBe("true");
    expect(f.groupOn.layouts).toBe(1);
    expect(f.groupOn.rows).toEqual(["true", "true", "true"]);
    expect(f.untick).toEqual({
      count: "3 of 5 modules on the canvas",
      tree: "false",
      group: "mixed",
    });
  });

  it("completes a partial tree folder, takes a checked one off, and opens and closes it by name", () => {
    expect(f.treeFolderPartialClick).toEqual({
      count: "4 of 5 modules on the canvas",
      state: "true",
      layouts: 1,
    });
    expect(f.treeFolderCheckedClick).toEqual({
      count: "1 of 5 modules on the canvas",
      state: "false",
    });
    expect(f.folderNameToggled).toBe(true);
  });

  it("gives all the tabs the one underline style", () => {
    expect(new Set(f.tabStyle).size).toBe(1);
    expect(f.tabStyle).toHaveLength(2);
    expect(f.activeTabStyle).toContain("inset");
  });

  it("has no picker, ghost, platform checkbox, row button, Tick all, Add, By name, or tree key", () => {
    expect(f.absent).toEqual({
      picker: 0,
      ghost: 0,
      platformCheckbox: 0,
      rowButtons: 0,
      labels: [],
      legend: true,
    });
  });

  it("still takes the selection off with Backspace", () => {
    expect(f.backspace.after).not.toBe(f.backspace.before);
  });

  it("takes a selected module off from the bar's last button", () => {
    expect(f.takeOffModule.after).not.toBe(f.takeOffModule.before);
    expect(f.takeOffModule.selected).toEqual([]);
  });

  it("ends a folder's bar with a separator and a take-off button that is not a cross, and takes everything in the folder off", () => {
    expect(f.takeOffFolder.bar).toEqual([
      "|",
      "Take off the canvas (Backspace)",
    ]);
    expect(f.takeOffFolder.title).toBe("Take off the canvas (Backspace)");
    expect(f.takeOffFolder.cross).toBe(false);
    expect(f.takeOffFolder.after).not.toBe(f.takeOffFolder.before);
  });
});
