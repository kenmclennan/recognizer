import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild";
import { beforeAll, describe, expect, it } from "vitest";

const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter((path): path is string => typeof path === "string" && path !== "");

const chrome = CHROME_CANDIDATES.find((path) => existsSync(path));

const here = (name: string) => fileURLToPath(new URL(name, import.meta.url));

const fakeWorker: Plugin = {
  name: "fake-layout-worker",
  setup(build) {
    build.onLoad({ filter: /layout-source\.ts$/ }, (args) => ({
      contents: readFileSync(args.path, "utf8").replace(
        'new Worker(new URL("./layout.worker.ts", import.meta.url))',
        "window.__fakeWorker()",
      ),
      loader: "ts",
    }));
  },
};

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { showExplorer } from ${JSON.stringify(here("explorer.ts"))};

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
const loaded = { modules: scan.modules.map((m) => m.id), scans: [{ file: "scan.json", scan }], policy: null, notices: [], blocking: null, findings: [], sensors: [] };

const app = document.getElementById("app");
showExplorer(app, loaded, "demo", (text) => { document.getElementById("module-count").textContent = text; });

const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const key = (k) => document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
const cs = (node) => getComputedStyle(node);
const treeRow = (p) => document.querySelector('.tree .row[data-path="' + p + '"]');
const pickRow = (id) => document.querySelector('.inspector-panel .row[data-id="' + id + '"]');
const count = () => document.getElementById("module-count").textContent;
const aria = (row) => row.querySelector(".rcheck").getAttribute("aria-checked");
const centre = (node) => { const r = node.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
const off = (id) => { const c = centre(document.querySelector('.box[data-id="' + id + '"]')); const s = centre(document.querySelector(".stage")); return Math.hypot(c.x - s.x, c.y - s.y); };
const selected = () => [...document.querySelectorAll(".box.selected")].map((n) => n.dataset.id);
const bar = (label) => document.querySelector('.selection-bar [aria-label^="' + label + '"]');
const heads = () => [...document.querySelectorAll(".inspector-panel .ofold")];
const sectionRows = () => document.querySelectorAll(".inspector-panel .row.file").length;
const look = (node) => { const c = cs(node.querySelector(".rcheck")); return [c.width, c.height, c.borderTopLeftRadius, c.borderTopWidth, c.borderTopColor, c.backgroundColor].join("|"); };
const tabs = () => [...document.querySelectorAll(".inspector-panel .itabs button")];
const facts = {};

click(treeRow("app").querySelector(".name"));
click(treeRow("lib").querySelector(".name"));
click(treeRow("app/hub.py").querySelector(".rcheck"));
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
facts.sections = heads().map((h) => h.textContent);
facts.openRows = sectionRows();
click(heads()[0]);
facts.afterCollapse = { heads: heads().map((h) => h.textContent), rows: sectionRows(), chevron: heads()[0].querySelector("svg path").getAttribute("d") };
click(heads()[0]);
facts.afterExpand = sectionRows();
facts.iconTitles = [...document.querySelectorAll("button")].filter((b) => b.querySelector("svg.i")).map((b) => b.title);
facts.barText = [...document.querySelectorAll(".selection-bar button")].map((b) => b.textContent);

facts.groupHeads = [...document.querySelectorAll(".inspector-panel .row.folder")].map((r) => r.querySelector(".name").textContent);
facts.pickOrder = [...pickRow("lib/c.py").children].map((c) => c.classList.contains("rcheck") ? "check" : c.classList.contains("name") ? "name" : c.classList.contains("disc") ? "disc" : c.classList.contains("detail") ? "detail" : "other");
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
facts.groupPartial = aria(pickRow("lib"));
facts.looks = {
  checked: [look(treeRow("lib/c.py")), look(pickRow("lib/c.py"))],
  unchecked: [look(treeRow("lib/d.py")), look(pickRow("lib/d.py"))],
  partial: [look(treeRow("lib")), look(pickRow("lib"))],
};
facts.looks.checkedBg = cs(pickRow("lib/c.py").querySelector(".rcheck")).backgroundColor;
facts.looks.uncheckedBg = cs(pickRow("lib/d.py").querySelector(".rcheck")).backgroundColor;
const layoutsGroup = layouts;
click(pickRow("lib").querySelector(".rcheck"));
facts.groupOn = { count: count(), state: aria(pickRow("lib")), layouts: layouts - layoutsGroup, rows: ["lib/c.py", "lib/d.py", "lib/e.py"].map((id) => aria(pickRow(id))) };
click(pickRow("lib/d.py").querySelector(".rcheck"));
facts.untick = { count: count(), tree: aria(treeRow("lib/d.py")), group: aria(pickRow("lib")) };
const layoutsFolder = layouts;
click(treeRow("lib").querySelector(".rcheck"));
facts.treeFolderPartialClick = { count: count(), state: aria(treeRow("lib")), layouts: layouts - layoutsFolder };
click(treeRow("lib").querySelector(".rcheck"));
facts.treeFolderCheckedClick = { count: count(), state: aria(treeRow("lib")) };
click(treeRow("lib").querySelector(".name"));
facts.folderNameToggled = treeRow("lib/c.py") === null;

facts.tabStyle = tabs().filter((t) => !t.classList.contains("on")).map((t) => { const c = cs(t); return [c.paddingTop, c.paddingLeft, c.fontSize, c.fontWeight, c.color, c.boxShadow, c.borderTopWidth].join("|"); });
facts.activeTabStyle = (() => { const c = cs(document.querySelector(".inspector-panel .itabs button.on")); return [c.fontWeight, c.boxShadow].join("|"); })();
facts.absent = {
  picker: document.querySelectorAll('[class*="picker"]').length,
  ghost: document.querySelectorAll('[class*="ghost"], [data-kind="ghost"]').length,
  platformCheckbox: document.querySelectorAll('.tree input[type="checkbox"], .inspector-panel input[type="checkbox"]').length,
  rowButtons: document.querySelectorAll(".tree .row button, .inspector-panel .row button").length,
  labels: [...document.querySelectorAll("button, [aria-label]")].filter((n) => !n.closest(".notes-panel")).map((n) => (n.getAttribute("aria-label") || "") + "|" + n.textContent).filter((t) => /Find on canvas|Put on the canvas|Tick all|By name|By module|^\\|Add/.test(t)),
  legend: document.querySelector(".tree .legend"),
};
facts.absent.legend = facts.absent.legend === null;

const before = count();
key("Backspace");
facts.backspace = { before, after: count(), selected: selected() };

const takeOffButton = () => document.querySelector('.selection-bar [aria-label="Take off the canvas (Backspace)"]');
click(treeRow("app/a.py").querySelector(".rcheck"));
click(document.querySelector('.box[data-id="app/a.py"] .box-body'));
const moduleBefore = count();
click(takeOffButton());
facts.takeOffModule = { before: moduleBefore, after: count(), selected: selected() };
click(treeRow("lib").querySelector(".rcheck"));
click(document.querySelector('.frame-label[data-id="lib"]'));
const folderBefore = count();
const folderBar = [...document.querySelectorAll(".selection-bar > *")].map((n) => n.classList.contains("bar-sep") ? "|" : n.getAttribute("aria-label") || n.textContent);
facts.takeOffFolder = { bar: folderBar.slice(-2), title: takeOffButton().title, cross: takeOffButton().querySelector("path[d*='M18 6L6 18']") !== null, before: folderBefore };
click(takeOffButton());
facts.takeOffFolder.after = count();

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
  sections: string[];
  openRows: number;
  afterCollapse: { heads: string[]; rows: number; chevron: string };
  afterExpand: number;
  iconTitles: string[];
  barText: string[];
  afterU: string;
  groupHeads: string[];
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
  groupOn: { count: string; state: string; layouts: number; rows: string[] };
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
  const dir = mkdtempSync(join(tmpdir(), "explorer-picker-"));

  try {
    const bundle = (
      await build({
        stdin: { contents: HARNESS, resolveDir: here("."), loader: "ts" },
        bundle: true,
        write: false,
        format: "iife",
        platform: "browser",
        plugins: [fakeWorker],
      })
    ).outputFiles[0].text;
    const css = readFileSync(here("style.css"), "utf8");
    const page = join(dir, "page.html");

    writeFileSync(
      page,
      `<!doctype html><html><head><style>${css}</style></head><body><div id="out"></div><span id="module-count"></span><div id="app" style="width:1400px;height:800px;display:flex;flex-direction:column"></div><script>${bundle.replaceAll("</script", "<\\/script")}</script></body></html>`,
    );

    const run = spawnSync(
      chrome as string,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--window-size=1500,900",
        `--user-data-dir=${join(dir, "profile")}`,
        "--dump-dom",
        `file://${page}`,
      ],
      { encoding: "utf8", timeout: 60000, maxBuffer: 16 * 1024 * 1024 },
    );
    const match = /<div id="out">([^<]*)<\/div>/.exec(run.stdout);

    if (match === null || !/^[A-Za-z0-9+/=]+$/.test(match[1])) {
      throw new Error(
        `no harness output: ${run.stderr.slice(0, 500)} ${run.error}`,
      );
    }

    const text = Buffer.from(match[1], "base64").toString("utf8");

    if (text.startsWith("ERR ")) {
      throw new Error(text);
    }

    return JSON.parse(text);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
}

describe.skipIf(chrome === undefined)("the picker as inspector tabs", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = await collect();
  }, 120000);

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

  it("lists a Uses and a Used by section with their counts, and collapses one without touching the other", () => {
    expect(f.sections).toEqual(["Uses 4", "Used by 0"]);
    expect(f.openRows).toBe(4);
    expect(f.afterCollapse.heads).toEqual(["Uses 4", "Used by 0"]);
    expect(f.afterCollapse.rows).toBe(0);
    expect(f.afterCollapse.chevron).toBe("M9 6l6 6-6 6");
    expect(f.afterExpand).toBe(4);
  });

  it("gives every icon button a tooltip and no bar button a word", () => {
    expect(f.iconTitles.length).toBeGreaterThan(0);
    expect(f.iconTitles.every((title) => title !== "")).toBe(true);

    for (const text of f.barText) {
      expect(text).toMatch(/^(\d+(\/\d+)?)?$/);
    }
  });

  it("groups by folder with the full path, one row each: checkbox, name, disc", () => {
    expect(f.groupHeads).toEqual(["app/", "lib/"]);
    expect(f.pickOrder).toEqual(["check", "name", "disc", "detail"]);
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

  it("draws the checkbox with the same computed look in the tree and the tab, in each state", () => {
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

  it("gives all three tabs the one underline style", () => {
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
