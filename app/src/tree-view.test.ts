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
import { buildSync } from "esbuild";
import { describe, expect, it } from "vitest";

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

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.lineno); });
import { buildCanvasView } from ${JSON.stringify(here("canvas-view.ts"))};
import { filterTree } from ${JSON.stringify(here("tree-filter.ts"))};
import { buildTree } from ${JSON.stringify(here("tree-model.ts"))};
import { buildTreeView } from ${JSON.stringify(here("tree-view.ts"))};

const calls = [];
const opened = new Set(["src/a.ts", "src/deep/d.ts"]);
const root = buildTree(["src/a.ts", "src/b.ts", "src/deep/d.ts", "lib/c.ts"]);
const filter = { text: "", onCanvas: false, needsAttention: false };
const context = { isOpen: (id) => opened.has(id), disc: () => "grey" };

const tree = buildTreeView({
  setText: (text) => calls.push(["setText", text]),
  toggleOnCanvas: () => calls.push(["toggleOnCanvas"]),
  toggleNeedsAttention: () => calls.push(["toggleNeedsAttention"]),
  toggleFolder: (path) => calls.push(["toggleFolder", path]),
  putOnCanvas: (id) => calls.push(["putOnCanvas", id]),
  takeOff: (id) => calls.push(["takeOff", id]),
  putFolderOnCanvas: (ids) => calls.push(["putFolderOnCanvas", ids.join(",")]),
  takeFolderOff: (ids) => calls.push(["takeFolderOff", ids.join(",")]),
  find: (id) => calls.push(["find", id]),
  hideTree: () => calls.push(["hideTree"]),
});

document.body.append(tree.element);

function props(over) {
  return {
    title: "shop",
    moduleCount: 4,
    filtered: filterTree(root, filter, context),
    described: new Map(),
    expanded: new Set(["src", "src/deep"]),
    selected: "src/deep/d.ts",
    isOpen: context.isOpen,
    filter: { ...filter, onCanvas: true },
    ...over,
  };
}

tree.render(props({}));

const probe = (css) => {
  const node = document.createElement("i");
  node.style.cssText = css;
  document.body.append(node);
  const value = getComputedStyle(node);
  return { color: value.color, background: value.backgroundColor };
};
const probes = {
  sel: probe("color: var(--sel); background: var(--selbg)"),
};

const cs = (node) => getComputedStyle(node);
const rowFor = (path) =>
  tree.element.querySelector('.row[data-path="' + path + '"]');
const action = (button) => ({
  aria: button.getAttribute("aria-label"),
  title: button.title,
  width: cs(button).width,
  height: cs(button).height,
  iconWidth: cs(button.querySelector("svg")).width,
  color: cs(button).color,
});
const kindOf = (child) =>
  child.classList.contains("rcheck") ? "check"
  : child.classList.contains("name") ? "name"
  : child.classList.contains("disc") ? "disc"
  : child.classList.contains("chevron") ? "chevron"
  : "other";
const describeRow = (path) => {
  const row = rowFor(path);
  const name = row.querySelector(".name");
  const chevron = row.querySelector(".chevron");
  const check = row.querySelector(".rcheck");
  return {
    text: name.textContent,
    classes: row.className,
    order: [...row.children].map(kindOf),
    height: cs(row).height,
    paddingLeft: cs(row).paddingLeft,
    discWidth: cs(row.querySelector(".disc")).width,
    discHeight: cs(row.querySelector(".disc")).height,
    discLeft: row.querySelector(".disc").getBoundingClientRect().left,
    checkLeft: check.getBoundingClientRect().left,
    nameWeight: cs(name).fontWeight,
    nameColor: cs(name).color,
    background: cs(row).backgroundColor,
    shadow: cs(row).boxShadow,
    chevron: chevron
      ? {
          width: cs(chevron).width,
          path: chevron.querySelector("path").getAttribute("d"),
          inline: chevron.tagName,
        }
      : null,
    check: {
      role: check.getAttribute("role"),
      aria: check.getAttribute("aria-checked"),
      tag: check.tagName,
      look: [cs(check).width, cs(check).height, cs(check).borderTopLeftRadius, cs(check).borderTopWidth].join(" "),
      background: cs(check).backgroundColor,
    },
    buttons: row.querySelectorAll("button").length,
    inputs: row.querySelectorAll("input").length,
  };
};

const rows = {};
for (const path of ["src", "src/deep", "src/deep/d.ts", "src/a.ts", "src/b.ts", "lib", "lib/c.ts"]) {
  if (rowFor(path)) rows[path] = describeRow(path);
}
tree.render(props({ expanded: new Set(["src", "lib"]), selected: "src/a.ts" }));
rows.plain = { lib: describeRow("lib"), libFile: describeRow("lib/c.ts"), a: describeRow("src/a.ts") };
tree.render(props({ expanded: new Set(["src", "lib"]), selected: null }));
rows.unselected = describeRow("src/b.ts");

const header = tree.element.querySelector(".tree-header");
const find = tree.element.querySelector(".find");
const chip = tree.element.querySelector(".toggle.on");
const chipOff = tree.element.querySelector(".toggle:not(.on)");

const hdr = {
  title: header.querySelector(".tree-title").textContent,
  titleWeight: cs(header.querySelector(".tree-title")).fontWeight,
  count: header.querySelector(".tree-count").textContent,
  countColor: cs(header.querySelector(".tree-count")).color,
  button: action(header.querySelector("button")),
  buttonIsLast: header.lastElementChild === header.querySelector("button"),
  findPlaceholder: find.placeholder,
  findType: find.type,
  chip: {
    height: cs(chip).height,
    radius: cs(chip).borderTopLeftRadius,
    background: cs(chip).backgroundColor,
    color: cs(chip).color,
  },
  chipOffHeight: cs(chipOff).height,
};

const treeText = tree.element.textContent;
const noLegend = tree.element.querySelector(".legend") === null;

calls.length = 0;
const pick = (path, selector) =>
  rowFor(path).querySelector(selector).dispatchEvent(new MouseEvent("click", { bubbles: true }));
tree.render(props({ expanded: new Set(["src", "lib"]), selected: null }));
pick("src/a.ts", ".name");
pick("src/b.ts", ".name");
pick("src/a.ts", ".rcheck");
pick("src/b.ts", ".rcheck");
pick("src", ".rcheck");
pick("lib", ".rcheck");
pick("src", ".name");
pick("src", ".chevron");
rowFor("src/a.ts").querySelector(".rcheck").dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
tree.element.querySelector(".tree-header button").click();
const allOpen = () => true;
tree.render(props({ expanded: new Set(["src", "lib"]), selected: null, isOpen: allOpen }));
const checkedFolder = describeRow("src");
pick("src", ".rcheck");
const clicks = calls.map((call) => call.join(":"));
tree.render(props({ expanded: new Set(["src", "lib"]), selected: null }));
const states = { src: describeRow("src").check.aria, lib: describeRow("lib").check.aria, a: describeRow("src/a.ts").check.aria, b: describeRow("src/b.ts").check.aria };

tree.render(props({ filtered: filterTree(root, { ...filter, text: "zzz" }, context), filter: { ...filter, text: "zzz" } }));
const empty = tree.element.querySelector(".empty").textContent;

const canvasActions = { find() {}, select() {}, takeOff() {}, openTab() {}, toggleFold() {}, openContents() {}, toggleFocus() {}, clear() {}, setShowInferred() {}, toggleTree: () => calls.push(["canvasToggle"]), measure: (t) => t.length * 7 };
const canvas = buildCanvasView(canvasActions);
document.body.append(canvas.element);
const canvasProps = (treeHidden) => ({ scene: null, selection: null, highlight: null, bar: null, titles: new Map(), open: 0, total: 4, treeHidden, showInferred: true, notice: null });
canvas.render(canvasProps(true));
const toggle = canvas.element.querySelector(".tree-toggle");
const shown = {
  floats: [cs(toggle).position, cs(toggle).left, cs(toggle).top].join(" "),
  topStrip: canvas.element.querySelector(".canvas-bar") === null,
  aria: toggle.getAttribute("aria-label"),
  title: toggle.title,
  hidden: cs(toggle).display,
  hasSvg: toggle.querySelector("svg.i") !== null,
  text: toggle.textContent,
};
calls.length = 0;
toggle.click();
shown.clicked = calls.map((call) => call.join(":"));
canvas.render(canvasProps(false));
shown.hiddenWhenTreeShown = cs(toggle).display;

document.getElementById("out").textContent = btoa(
  unescape(encodeURIComponent(JSON.stringify({ rows, hdr, treeText, noLegend, clicks, empty, probes, shown, checkedFolder, states }))),
);
`;

type Button = {
  aria: string;
  title: string;
  width: string;
  height: string;
  iconWidth: string;
  color: string;
};

type RowFacts = {
  text: string;
  classes: string;
  height: string;
  paddingLeft: string;
  discWidth: string;
  discHeight: string;
  discLeft: number;
  checkLeft: number;
  nameWeight: string;
  nameColor: string;
  background: string;
  shadow: string;
  chevron: { width: string; path: string; inline: string } | null;
  order: string[];
  check: {
    role: string;
    aria: string;
    tag: string;
    look: string;
    background: string;
  };
  buttons: number;
  inputs: number;
};

type Facts = {
  rows: Record<string, RowFacts> & {
    plain: Record<string, RowFacts>;
    unselected: RowFacts;
  };
  hdr: {
    title: string;
    titleWeight: string;
    count: string;
    countColor: string;
    button: Button;
    buttonIsLast: boolean;
    findPlaceholder: string;
    findType: string;
    chip: { height: string; radius: string; background: string; color: string };
    chipOffHeight: string;
  };
  treeText: string;
  noLegend: boolean;
  states: Record<string, string>;
  checkedFolder: RowFacts;
  clicks: string[];
  empty: string;
  probes: { sel: { color: string; background: string } };
  shown: {
    floats: string;
    topStrip: boolean;
    aria: string;
    title: string;
    hidden: string;
    hasSvg: boolean;
    text: string;
    clicked: string[];
    hiddenWhenTreeShown: string;
  };
};

function collect(): Facts {
  const dir = mkdtempSync(join(tmpdir(), "tree-view-"));

  try {
    const bundle = buildSync({
      stdin: { contents: HARNESS, resolveDir: dir, loader: "ts" },
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
    }).outputFiles[0].text;
    const css = readFileSync(here("style.css"), "utf8");
    const page = join(dir, "page.html");

    writeFileSync(
      page,
      `<!doctype html><html><head><style>${css}</style></head><body><div id="out"></div><script>${bundle.replaceAll("</script", "<\\/script")}</script></body></html>`,
    );

    const run = spawnSync(
      chrome as string,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
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

describe.skipIf(chrome === undefined)("tree view in a real browser", () => {
  const facts = chrome === undefined ? null : collect();
  const f = facts as Facts;

  it("starts with the repository name, its module count and a hide-the-tree icon button", () => {
    expect(f.hdr.title).toBe("shop");
    expect(Number(f.hdr.titleWeight)).toBeGreaterThanOrEqual(600);
    expect(f.hdr.count).toBe("4");
    expect(f.hdr.countColor).not.toBe(f.probes.sel.color);
    expect(f.hdr.button.aria).toBe("Hide the tree");
    expect(f.hdr.button.title).toBe("Hide the tree");
    expect(f.hdr.buttonIsLast).toBe(true);
    expect(f.hdr.button.width).toBe("22px");
    expect(f.hdr.button.iconWidth).toBe("14px");
  });

  it("puts the show-the-tree icon button at the left of the canvas bar only while the tree is hidden", () => {
    expect(f.shown.floats).toBe("absolute 14px 14px");
    expect(f.shown.topStrip).toBe(true);
    expect(f.shown.aria).toBe("Show the tree");
    expect(f.shown.title).toBe("Show the tree");
    expect(f.shown.hasSvg).toBe(true);
    expect(f.shown.text).toBe("");
    expect(f.shown.hidden).not.toBe("none");
    expect(f.shown.hiddenWhenTreeShown).toBe("none");
    expect(f.shown.clicked).toEqual(["canvasToggle"]);
  });

  it("has a plain text find field reading Find a file", () => {
    expect(f.hdr.findPlaceholder).toBe("Find a file");
    expect(f.hdr.findType).toBe("text");
  });

  it("draws folder chevrons as 12px inline svg, right when closed and down when open", () => {
    expect(f.rows.src.chevron).toEqual({
      width: "12px",
      path: "M6 9l6 6 6-6",
      inline: "svg",
    });
    expect(f.rows.plain.lib.chevron?.path).toBe("M6 9l6 6 6-6");
    expect(f.rows.unselected.chevron).toBeNull();
    expect(f.treeText).not.toMatch(/[\u25b8\u25be]/);
  });

  it("ends folder names with a slash and leaves file names bare", () => {
    expect(f.rows.src.text).toBe("src/");
    expect(f.rows.lib.text).toBe("lib/");
    expect(f.rows["src/a.ts"].text).toBe("a.ts");
  });

  it("builds every row as chevron, checkbox, name, disc with the chevron on folders only", () => {
    expect(f.rows.src.order).toEqual(["chevron", "check", "name", "disc"]);
    expect(f.rows["src/deep"].order).toEqual([
      "chevron",
      "check",
      "name",
      "disc",
    ]);
    expect(f.rows["src/a.ts"].order).toEqual(["check", "name", "disc"]);
    expect(f.rows["src/b.ts"].order).toEqual(["check", "name", "disc"]);
  });

  it("has no eye, target, plus or any button on a row, no platform checkbox and no disc key", () => {
    for (const row of [f.rows.src, f.rows["src/a.ts"], f.rows["src/b.ts"]]) {
      expect(row.buttons).toBe(0);
      expect(row.inputs).toBe(0);
      expect(row.check.tag).toBe("SPAN");
      expect(row.check.role).toBe("checkbox");
    }

    expect(f.noLegend).toBe(true);
  });

  it("draws a 14px rounded app checkbox, checked, unchecked and partial", () => {
    expect(f.rows["src/a.ts"].check.aria).toBe("true");
    expect(f.rows["src/b.ts"].check.aria).toBe("false");
    expect(f.rows.src.check.aria).toBe("mixed");
    expect(f.checkedFolder.check.aria).toBe("true");

    for (const row of [f.rows["src/a.ts"], f.rows["src/b.ts"], f.rows.src]) {
      expect(row.check.look.startsWith("14px 14px 4px")).toBe(true);
    }

    expect(f.rows["src/a.ts"].check.background).toBe(
      f.rows.src.check.background,
    );
    expect(f.rows["src/a.ts"].check.background).not.toBe(
      f.rows["src/b.ts"].check.background,
    );
  });

  it("bolds the name of a row on the canvas and of a folder holding one", () => {
    expect(Number(f.rows["src/a.ts"].nameWeight)).toBeGreaterThanOrEqual(600);
    expect(Number(f.rows.src.nameWeight)).toBeGreaterThanOrEqual(600);
    expect(Number(f.rows["src/b.ts"].nameWeight)).toBeLessThan(600);
    expect(Number(f.rows.plain.lib.nameWeight)).toBeLessThan(600);
  });

  it("gives the selected row the selection background and a 2px bar on its left edge", () => {
    const row = f.rows["src/deep/d.ts"];

    expect(row.classes).toContain("selected");
    expect(row.background).toBe(f.probes.sel.background);
    expect(row.shadow).toContain("2px 0px 0px 0px inset");
    expect(row.shadow).toContain(f.probes.sel.color);
    expect(f.rows.unselected.background).not.toBe(f.probes.sel.background);
    expect(f.rows.unselected.shadow).toBe("none");
  });

  it("shows folders above the selection with their name in the selection colour", () => {
    expect(f.rows.src.nameColor).toBe(f.probes.sel.color);
    expect(f.rows["src/deep"].nameColor).toBe(f.probes.sel.color);
    expect(f.rows.lib.nameColor).not.toBe(f.probes.sel.color);
    expect(f.rows["src/deep/d.ts"].nameColor).not.toBe(f.probes.sel.color);
  });

  it("wires a name click as find, a checkbox click as put on or take off, and a folder name as open and close", () => {
    expect(f.clicks).toEqual([
      "find:src/a.ts",
      "find:src/b.ts",
      "takeOff:src/a.ts",
      "putOnCanvas:src/b.ts",
      "putFolderOnCanvas:src/deep/d.ts,src/a.ts,src/b.ts",
      "putFolderOnCanvas:lib/c.ts",
      "toggleFolder:src",
      "toggleFolder:src",
      "takeOff:src/a.ts",
      "hideTree",
      "takeFolderOff:src/deep/d.ts,src/a.ts,src/b.ts",
    ]);
  });

  it("sizes rows 26px, indents 14px a level with files 18px further and discs 9px", () => {
    expect(f.rows.src.height).toBe("26px");
    expect(f.rows["src/a.ts"].height).toBe("26px");
    expect(f.rows.src.paddingLeft).toBe("4px");
    expect(f.rows["src/deep"].paddingLeft).toBe("18px");
    expect(f.rows["src/a.ts"].paddingLeft).toBe("36px");
    expect(f.rows["src/deep/d.ts"].paddingLeft).toBe("50px");
    expect(f.rows.src.discWidth).toBe("9px");
    expect(f.rows["src/a.ts"].discHeight).toBe("9px");
  });

  it("lines a file's checkbox up under the checkbox of a folder at the same level", () => {
    expect(f.rows["src/a.ts"].checkLeft).toBe(f.rows["src/deep"].checkLeft);
    expect(f.rows["src/deep/d.ts"].checkLeft).toBeGreaterThan(
      f.rows["src/deep"].checkLeft,
    );
  });

  it("draws filter chips 24px high, fully rounded, in the selection colours when on", () => {
    expect(f.hdr.chip.height).toBe("24px");
    expect(f.hdr.chipOffHeight).toBe("24px");
    expect(f.hdr.chip.radius).toBe("12px");
    expect(f.hdr.chip.background).toBe(f.probes.sel.background);
    expect(f.hdr.chip.color).toBe(f.probes.sel.color);
  });

  it("reads Nothing matches. when the filter leaves no files", () => {
    expect(f.empty).toBe("Nothing matches.");
  });
});
