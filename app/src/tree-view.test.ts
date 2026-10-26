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
  find: (id) => calls.push(["find", id]),
  findFolder: (id) => calls.push(["findFolder", id]),
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
const describeRow = (path) => {
  const row = rowFor(path);
  const acts = row.querySelector(".actions");
  const name = row.querySelector(".name");
  const chevron = row.querySelector(".chevron");
  return {
    text: name.textContent,
    classes: row.className,
    height: cs(row).height,
    paddingLeft: cs(row).paddingLeft,
    discWidth: cs(row.querySelector(".disc")).width,
    discHeight: cs(row.querySelector(".disc")).height,
    discLeft: row.querySelector(".disc").getBoundingClientRect().left,
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
    actionsDisplay: cs(acts).display,
    buttons: [...acts.querySelectorAll("button")].map(action),
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

calls.length = 0;
const click = (selector) => rowFor(selector).click();
tree.render(props({ expanded: new Set(["src", "lib"]), selected: null }));
click("src/a.ts");
click("src/b.ts");
rowFor("src/a.ts").querySelector('[aria-label="Take off the canvas"]').click();
rowFor("src/b.ts").querySelector('[aria-label="Put on the canvas"]').click();
rowFor("src").querySelector('[aria-label="Find on canvas"]').click();
tree.element.querySelector(".tree-header button").click();
const clicks = calls.map((call) => call.join(":"));

tree.render(props({ filtered: filterTree(root, { ...filter, text: "zzz" }, context), filter: { ...filter, text: "zzz" } }));
const empty = tree.element.querySelector(".empty").textContent;

const canvasActions = { find() {}, select() {}, takeOff() {}, toggleFold() {}, toggleFocus() {}, clear() {}, setShowInferred() {}, toggleTree: () => calls.push(["canvasToggle"]), measure: (t) => t.length * 7 };
const canvas = buildCanvasView(canvasActions);
document.body.append(canvas.element);
const canvasProps = (treeHidden) => ({ scene: null, selection: null, highlight: null, bar: null, titles: new Map(), evidence: null, open: 0, total: 4, treeHidden, showInferred: true, notice: null });
canvas.render(canvasProps(true));
const bar = canvas.element.querySelector(".canvas-bar");
const toggle = bar.querySelector(".tree-toggle");
const shown = {
  first: bar.firstElementChild === toggle,
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
  unescape(encodeURIComponent(JSON.stringify({ rows, hdr, treeText, clicks, empty, probes, shown }))),
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
  nameWeight: string;
  nameColor: string;
  background: string;
  shadow: string;
  chevron: { width: string; path: string; inline: string } | null;
  actionsDisplay: string;
  buttons: Button[];
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
  clicks: string[];
  empty: string;
  probes: { sel: { color: string; background: string } };
  shown: {
    first: boolean;
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
    expect(f.shown.first).toBe(true);
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

  it("shows a plus on hover for a file off the canvas", () => {
    const row = f.rows["src/b.ts"];

    expect(row.actionsDisplay).toBe("none");
    expect(row.buttons.map((b) => [b.aria, b.title])).toEqual([
      ["Put on the canvas", "Put on the canvas"],
    ]);
    expect(row.buttons[0].width).toBe("22px");
    expect(row.buttons[0].height).toBe("22px");
    expect(row.buttons[0].iconWidth).toBe("14px");
  });

  it("always shows a target and a selection-coloured eye for a file on the canvas", () => {
    const row = f.rows["src/a.ts"];

    expect(row.actionsDisplay).toBe("flex");
    expect(row.buttons.map((b) => [b.aria, b.title])).toEqual([
      ["Find on canvas", "Find on canvas"],
      ["Take off the canvas", "Take off the canvas"],
    ]);
    expect(row.buttons[1].color).toBe(f.probes.sel.color);
    expect(row.buttons[0].color).not.toBe(f.probes.sel.color);
    expect(row.buttons.every((b) => b.iconWidth === "14px")).toBe(true);
  });

  it("shows the target on a folder holding a file on the canvas and nothing on one that holds none", () => {
    expect(f.rows.src.buttons.map((b) => b.aria)).toEqual(["Find on canvas"]);
    expect(f.rows.src.actionsDisplay).toBe("flex");
    expect(f.rows.plain.lib.buttons).toEqual([]);
    expect(f.rows.plain.lib.actionsDisplay).toBe("none");
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

  it("selects a file row on the canvas when it is on the canvas and puts it there when it is not", () => {
    expect(f.clicks.slice(0, 2)).toEqual([
      "find:src/a.ts",
      "putOnCanvas:src/b.ts",
    ]);
  });

  it("wires the row icons and the header button to their actions", () => {
    expect(f.clicks.slice(2)).toEqual([
      "takeOff:src/a.ts",
      "putOnCanvas:src/b.ts",
      "findFolder:src",
      "hideTree",
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

  it("lines a file's disc up under the disc of a folder at the same level", () => {
    expect(f.rows["src/a.ts"].discLeft).toBe(f.rows["src/deep"].discLeft);
    expect(f.rows["src/deep/d.ts"].discLeft).toBeGreaterThan(
      f.rows["src/deep"].discLeft,
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
