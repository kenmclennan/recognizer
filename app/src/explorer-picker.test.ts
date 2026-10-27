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
const loaded = { modules: scan.modules.map((m) => m.id), scans: [{ file: "scan.json", scan }], policy: null, notices: [], blocking: null };

const app = document.getElementById("app");
showExplorer(app, loaded, "demo");

const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const key = (k) => document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
const cs = (node) => getComputedStyle(node);
const treeRow = (p) => document.querySelector('.tree .row[data-path="' + p + '"]');
const pickRow = (id) => document.querySelector('.inspector-panel .row[data-id="' + id + '"]');
const count = () => document.getElementById("canvas-count").textContent;
const aria = (row) => row.querySelector(".rcheck").getAttribute("aria-checked");
const centre = (node) => { const r = node.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
const off = (id) => { const c = centre(document.querySelector('.box[data-id="' + id + '"]')); const s = centre(document.querySelector(".stage")); return Math.hypot(c.x - s.x, c.y - s.y); };
const selected = () => [...document.querySelectorAll(".box.selected")].map((n) => n.dataset.id);
const bar = (text) => [...document.querySelectorAll(".selection-bar .bar-button")].find((b) => b.textContent.startsWith(text));
const look = (node) => { const c = cs(node.querySelector(".rcheck")); return [c.width, c.height, c.borderTopLeftRadius, c.borderTopWidth, c.borderTopColor, c.backgroundColor].join("|"); };
const tabs = () => [...document.querySelectorAll(".inspector-panel .itabs button")];
const facts = {};

click(treeRow("app").querySelector(".name"));
click(treeRow("lib").querySelector(".name"));
click(treeRow("app/hub.py").querySelector(".rcheck"));
facts.afterHub = count();
click(document.querySelector('.box[data-id="app/hub.py"] .box-body'));
facts.selectedHub = selected();
click(bar("Uses"));
facts.tabs = tabs().map((t) => t.textContent);
facts.activeTab = tabs().filter((t) => t.classList.contains("on")).map((t) => t.textContent);
facts.barLit = bar("Uses").classList.contains("on");
click(bar("Uses"));
facts.stillShown = document.querySelector(".inspector-panel .itabs button.on").textContent;
key("d");
facts.afterD = [document.querySelector(".inspector-panel .itabs button.on").textContent, bar("Used by").disabled, bar("Uses").classList.contains("on")];
key("u");
facts.afterU = document.querySelector(".inspector-panel .itabs button.on").textContent;

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
  labels: [...document.querySelectorAll("button, [aria-label]")].map((n) => (n.getAttribute("aria-label") || "") + "|" + n.textContent).filter((t) => /Find on canvas|Take off|Put on the canvas|Tick all|By name|By module|^\\|Add/.test(t)),
  legend: document.querySelector(".tree .legend"),
  takeOffButton: document.querySelector('.selection-bar [aria-label="Take off the canvas"]'),
};
facts.absent.legend = facts.absent.legend === null;
facts.absent.takeOffButton = facts.absent.takeOffButton === null;

const before = count();
key("Backspace");
facts.backspace = { before, after: count(), selected: selected() };

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
    takeOffButton: boolean;
  };
  backspace: { before: string; after: string; selected: string[] };
};

async function collect(): Promise<Facts> {
  const dir = mkdtempSync(join(tmpdir(), "explorer-picker-"));

  try {
    const bundle = (
      await build({
        stdin: { contents: HARNESS, resolveDir: dir, loader: "ts" },
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
      `<!doctype html><html><head><style>${css}</style></head><body><div id="out"></div><div id="app" style="width:1400px;height:800px;display:flex;flex-direction:column"></div><script>${bundle.replaceAll("</script", "<\\/script")}</script></body></html>`,
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
      { encoding: "utf8", timeout: 60000 },
    );
    const match = /<div id="out">([^<]*)<\/div>/.exec(run.stdout);

    if (match === null || !/^[A-Za-z0-9+/=]+$/.test(match[1])) {
      throw new Error(`no harness output: ${run.stderr.slice(0, 500)}`);
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

  it("opens Uses and Used by as the third and fourth inspector tab, lit on the bar, and stays on a second press", () => {
    expect(f.tabs).toEqual(["Contents", "Findings", "Uses 4", "Used by 0"]);
    expect(f.activeTab).toEqual(["Uses 4"]);
    expect(f.barLit).toBe(true);
    expect(f.stillShown).toBe("Uses 4");
  });

  it("maps U to the Uses tab and does nothing for D when nothing uses the module", () => {
    expect(f.afterD).toEqual(["Uses 4", true, true]);
    expect(f.afterU).toBe("Uses 4");
  });

  it("groups by folder with the full path, one row each: checkbox, name, disc", () => {
    expect(f.groupHeads).toEqual(["app/", "lib/"]);
    expect(f.pickOrder).toEqual(["check", "name", "disc", "detail"]);
  });

  it("clicking an unchecked name puts it on, ticks it in the tree and Uses, centres on its box and keeps the selection", () => {
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

  it("gives all four tabs the one underline style", () => {
    expect(new Set(f.tabStyle).size).toBe(1);
    expect(f.tabStyle).toHaveLength(3);
    expect(f.activeTabStyle).toContain("inset");
  });

  it("has no picker, ghost, platform checkbox, row button, Tick all, Add, By name, take-off or tree key", () => {
    expect(f.absent).toEqual({
      picker: 0,
      ghost: 0,
      platformCheckbox: 0,
      rowButtons: 0,
      labels: [],
      legend: true,
      takeOffButton: true,
    });
  });

  it("still takes the selection off with Backspace", () => {
    expect(f.backspace.after).not.toBe(f.backspace.before);
  });
});
