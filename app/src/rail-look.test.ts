import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { describe, expect, it } from "vitest";
import { HIDE_SCROLLBARS, lookBrowserArgs, webkit } from "./look-page";

const here = (name: string) => fileURLToPath(new URL(name, import.meta.url));

const HARNESS = `
import { buildRailView } from ${JSON.stringify(here("rail-view.ts"))};

const grid = document.createElement("div");
grid.className = "explorer";
grid.style.cssText = "width:1000px;height:600px";

let hidden = false;
let notesTotal = 3;
const rail = buildRailView({
  toggleFiles() {
    hidden = !hidden;
    grid.classList.toggle("tree-hidden", hidden);
    rail.render({ panel: hidden ? null : "files", notes: notesTotal, scanFailed: false, findings: { count: 0, tone: "none" } });
  },
  toggleNotes() {},
  toggleScan() {},
  toggleFindings() {},
});
const tree = document.createElement("aside");
tree.className = "tree";
const canvas = document.createElement("main");
canvas.className = "canvas";
const inspector = document.createElement("aside");
inspector.className = "inspector";

grid.append(rail.element, tree, canvas, inspector);
document.body.append(grid);
rail.render({ panel: "files", notes: notesTotal, scanFailed: false, findings: { count: 0, tone: "none" } });

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

const notesButton = rail.element.querySelector(".rail-notes");
const countOf = () => rail.element.querySelector(".rail-count");
const notesFacts = {
  aria: notesButton.getAttribute("aria-label"),
  count: countOf().textContent,
  countHidden: countOf().hidden,
  order: [...rail.element.querySelectorAll("button")].map((b) => b.className.split(" ")[1]),
};
notesTotal = 0;
rail.render({ panel: "files", notes: 0, scanFailed: false, findings: { count: 0, tone: "none" } });
notesFacts.zeroHidden = countOf().hidden;
notesFacts.zeroText = countOf().textContent;
notesTotal = 3;
rail.render({ panel: "files", notes: 3, scanFailed: false, findings: { count: 0, tone: "none" } });

const foundEl = () => rail.element.querySelector(".rail-findings .rail-count");
const badgeFacts = (findings) => {
  rail.render({ panel: "files", notes: 3, scanFailed: false, findings });
  const box = foundEl().getBoundingClientRect();
  return { text: foundEl().textContent, hidden: foundEl().hidden, width: box.width, height: box.height, radius: cs(foundEl()).borderTopLeftRadius, background: cs(foundEl()).backgroundColor };
};
const findingsFacts = {
  red: badgeFacts({ count: 4, tone: "red" }),
  amber: badgeFacts({ count: 0, tone: "amber" }),
  none: badgeFacts({ count: 0, tone: "none" }),
};
rail.render({ panel: "files", notes: 3, scanFailed: false, findings: { count: 0, tone: "none" } });

const rect = rail.element.getBoundingClientRect();
const facts = {
  findingsFacts,
  colours,
  tag: rail.element.tagName,
  buttons: rail.element.querySelectorAll("button").length,
  children: rail.element.children.length,
  aria: button.getAttribute("aria-label"),
  title: button.title,
  label: button.getAttribute("data-label"),
  titles: [...rail.element.querySelectorAll("button")].map((b) => b.title),
  iconSize: cs(button.querySelector("svg")).width,
  strokeWidth: cs(button.querySelector("svg")).strokeWidth,
  rail: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
  treeLeft: tree.getBoundingClientRect().left,
  gridHeight: grid.getBoundingClientRect().height,
  shown: state(),
  notesFacts,
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
  label: string;
  titles: string[];
  iconSize: string;
  strokeWidth: string;
  rail: { left: number; top: number; width: number; height: number };
  treeLeft: number;
  gridHeight: number;
  findingsFacts: Record<
    "red" | "amber" | "none",
    {
      text: string;
      hidden: boolean;
      width: number;
      height: number;
      radius: string;
      background: string;
    }
  >;
  notesFacts: {
    aria: string;
    count: string;
    countHidden: boolean;
    order: string[];
    zeroHidden: boolean;
    zeroText: string;
  };
  shown: State;
  afterHide: State;
  afterShow: State;
};

function collect(): Facts {
  const dir = mkdtempSync(join(tmpdir(), "rail-look-"));

  try {
    const bundle = buildSync({
      stdin: { contents: HARNESS, resolveDir: here("."), loader: "ts" },
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
    }).outputFiles[0].text;
    const css = readFileSync(here("style.css"), "utf8");
    const page = join(dir, "page.html");

    writeFileSync(
      page,
      `<!doctype html><html><head><style>${css}${HIDE_SCROLLBARS}</style></head><body><div id="out"></div><script>${bundle.replaceAll("</script", "<\\/script")}</script></body></html>`,
    );

    const run = spawnSync(
      process.execPath,
      lookBrowserArgs(page, { size: "800x600" }),
      { encoding: "utf8", timeout: 60000, maxBuffer: 16 * 1024 * 1024 },
    );
    const match = /<div id="out">([^<]*)<\/div>/.exec(run.stdout);

    if (match === null || !/^[A-Za-z0-9+/=]+$/.test(match[1])) {
      throw new Error(
        `no harness output: ${run.stderr.slice(0, 500)} ${run.error}`,
      );
    }

    return JSON.parse(atob(match[1])) as Facts;
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
}

describe.skipIf(webkit === undefined)("the rail in a real browser", () => {
  const f = (webkit === undefined ? null : collect()) as Facts;

  it("sits full height at the window's left holding a 16px stroke-2 Files button then Views, Notes, Scan and Findings buttons", () => {
    expect(f.tag).toBe("NAV");
    expect(f.children).toBe(5);
    expect(f.buttons).toBe(5);
    expect(f.notesFacts.order).toEqual([
      "rail-files",
      "rail-views",
      "rail-notes",
      "rail-scan",
      "rail-findings",
    ]);
    expect(f.aria).toBe("Files");
    expect(f.label).toBe("Files");
    expect(f.titles).toEqual(["", "", "", "", ""]);
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

  it("shows the note count on the Notes icon and nothing at zero", () => {
    expect(f.notesFacts.aria).toBe("Notes");
    expect(f.notesFacts.count).toBe("3");
    expect(f.notesFacts.countHidden).toBe(false);
    expect(f.notesFacts.zeroHidden).toBe(true);
    expect(f.notesFacts.zeroText).toBe("");
  });

  it("shows the violation count in red, a bare amber dot for warnings only and nothing otherwise", () => {
    expect(f.findingsFacts.red.text).toBe("4");
    expect(f.findingsFacts.red.hidden).toBe(false);
    expect(f.findingsFacts.red.background).toBe("rgb(192, 57, 43)");
    expect(f.findingsFacts.amber.text).toBe("");
    expect(f.findingsFacts.amber.hidden).toBe(false);
    expect(f.findingsFacts.amber.background).toBe("rgb(185, 119, 14)");
    expect(f.findingsFacts.amber.width).toBe(8);
    expect(f.findingsFacts.amber.height).toBe(8);
    expect(f.findingsFacts.amber.radius).toBe("50%");
    expect(f.findingsFacts.none.hidden).toBe(true);
  });
});
