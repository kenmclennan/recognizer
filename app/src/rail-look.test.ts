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
import { buildRailView } from ${JSON.stringify(here("rail-view.ts"))};

const grid = document.createElement("div");
grid.className = "explorer";
grid.style.cssText = "width:1000px;height:600px";

let hidden = false;
const rail = buildRailView({
  toggleFiles() {
    hidden = !hidden;
    grid.classList.toggle("tree-hidden", hidden);
    rail.render(!hidden);
  },
});
const tree = document.createElement("aside");
tree.className = "tree";
const canvas = document.createElement("main");
canvas.className = "canvas";
const inspector = document.createElement("aside");
inspector.className = "inspector";

grid.append(rail.element, tree, canvas, inspector);
document.body.append(grid);
rail.render(true);

const cs = (node) => getComputedStyle(node);
const probe = document.createElement("i");
probe.style.cssText = "color: var(--sel); background: var(--fg)";
document.body.append(probe);
const colours = { sel: cs(probe).color, fg: cs(probe).backgroundColor };

const button = rail.element.querySelector("button");
const state = () => {
  const bar = getComputedStyle(button, "::before");
  return {
    pressed: button.getAttribute("aria-pressed"),
    open: button.classList.contains("open"),
    treeDisplay: cs(tree).display,
    canvasWidth: canvas.getBoundingClientRect().width,
    color: cs(button).color,
    barWidth: bar.width,
    barBackground: bar.backgroundColor,
  };
};

const rect = rail.element.getBoundingClientRect();
const facts = {
  colours,
  tag: rail.element.tagName,
  buttons: rail.element.querySelectorAll("button").length,
  children: rail.element.children.length,
  aria: button.getAttribute("aria-label"),
  title: button.title,
  iconSize: cs(button.querySelector("svg")).width,
  strokeWidth: cs(button.querySelector("svg")).strokeWidth,
  rail: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
  treeLeft: tree.getBoundingClientRect().left,
  gridHeight: grid.getBoundingClientRect().height,
  shown: state(),
};
button.click();
facts.afterHide = state();
button.click();
facts.afterShow = state();

document.getElementById("out").textContent = btoa(JSON.stringify(facts));
`;

type State = {
  pressed: string;
  open: boolean;
  treeDisplay: string;
  canvasWidth: number;
  color: string;
  barWidth: string;
  barBackground: string;
};

type Facts = {
  colours: { sel: string; fg: string };
  tag: string;
  buttons: number;
  children: number;
  aria: string;
  title: string;
  iconSize: string;
  strokeWidth: string;
  rail: { left: number; top: number; width: number; height: number };
  treeLeft: number;
  gridHeight: number;
  shown: State;
  afterHide: State;
  afterShow: State;
};

function collect(): Facts {
  const dir = mkdtempSync(join(tmpdir(), "rail-look-"));

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

    return JSON.parse(atob(match[1])) as Facts;
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
}

describe.skipIf(chrome === undefined)("the rail in a real browser", () => {
  const f = (chrome === undefined ? null : collect()) as Facts;

  it("sits full height at the window's left holding exactly one 16px stroke-2 Files button", () => {
    expect(f.tag).toBe("NAV");
    expect(f.children).toBe(1);
    expect(f.buttons).toBe(1);
    expect(f.aria).toBe("Files");
    expect(f.title).toBe("Files");
    expect(f.iconSize).toBe("16px");
    expect(f.strokeWidth).toBe("2px");
    expect(f.rail.left).toBe(0);
    expect(f.rail.top).toBe(0);
    expect(f.rail.height).toBe(f.gridHeight);
    expect(f.treeLeft).toBe(f.rail.width);
  });

  it("marks the Files button with a selection-colour bar and full-strength icon while the tree shows", () => {
    expect(f.shown.open).toBe(true);
    expect(f.shown.pressed).toBe("true");
    expect(f.shown.treeDisplay).not.toBe("none");
    expect(f.shown.barWidth).toBe("2px");
    expect(f.shown.barBackground).toBe(f.colours.sel);
    expect(f.shown.color).not.toBe(f.afterHide.color);
  });

  it("hides the tree and widens the canvas on a click and restores both on the next", () => {
    expect(f.afterHide.open).toBe(false);
    expect(f.afterHide.pressed).toBe("false");
    expect(f.afterHide.treeDisplay).toBe("none");
    expect(f.afterHide.barBackground).not.toBe(f.colours.sel);
    expect(f.afterHide.canvasWidth - f.shown.canvasWidth).toBe(280);
    expect(f.afterShow).toEqual(f.shown);
  });
});
