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
import { buildInspectorView } from ${JSON.stringify(here("inspector-view.ts"))};
import { inspectorContent } from ${JSON.stringify(here("inspector-model.ts"))};

const scan = { modules: [{ id: "p/m.py", kind: "module" }], edges: [], foreign: [], calls: [] };
const inputs = {
  scans: [scan],
  modules: ["p/m.py"],
  disc: () => "green",
  findings: () => [],
  onCanvas: () => true,
  expanded: new Set(),
  showPrivate: true,
  tab: "contents",
  evidence: null,
  edgeOnCanvas: true,
  counts: () => ({ uses: 0, usedBy: 0 }),
  filter: "",
  collapsed: new Set(),
  responsibility: () => ({ state: { kind: "missing" }, busy: false, failure: null }),
 
};
const noop = () => {};
const actions = new Proxy({}, { get: () => noop });

const win = document.createElement("div");
win.className = "window";
win.style.cssText = "width:1173px;height:772px";
const content = document.createElement("div");
content.className = "content";
const footer = document.createElement("footer");
footer.className = "footer";
footer.textContent = "footer";
const notices = document.createElement("div");
notices.className = "notices";
notices.hidden = true;
const grid = document.createElement("div");
grid.className = "explorer";
const rail = document.createElement("nav");
rail.style.cssText = "width:40px";
const tree = document.createElement("aside");
tree.className = "tree";
const canvas = document.createElement("main");
canvas.className = "canvas";
const view = buildInspectorView(actions);
grid.append(rail, tree, canvas, view.element);
content.append(notices, grid);
win.append(content, footer);
document.body.style.margin = "0";
document.body.append(win);

const selection = { kind: "module", id: "p/m.py" };
const measure = (inner) => {
  const g = grid.getBoundingClientRect();
  const r = view.element.getBoundingClientRect();
  const rr = view.element.querySelector(inner).getBoundingClientRect();
  return { explorerBottom: g.bottom, inspectorBottom: r.bottom, innerBottom: rr.bottom, footerTop: footer.getBoundingClientRect().top };
};
const facts = {};
const open = (isOpen) => {
  grid.classList.toggle("inspector-open", isOpen);
  view.render(inspectorContent(selection, inputs), isOpen);
};
open(false);
facts.closed = measure(".inspector-rail");
open(true);
facts.open = measure(".inspector-panel");
document.getElementById("out").textContent = btoa(JSON.stringify(facts));
`;

type Measure = {
  explorerBottom: number;
  inspectorBottom: number;
  innerBottom: number;
  footerTop: number;
};

function collect(): { closed: Measure; open: Measure } {
  const dir = mkdtempSync(join(tmpdir(), "inspector-height-look-"));

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
      { encoding: "utf8", timeout: 60000, maxBuffer: 16 * 1024 * 1024 },
    );
    const match = /<div id="out">([^<]*)<\/div>/.exec(run.stdout);

    if (match === null || !/^[A-Za-z0-9+/=]+$/.test(match[1])) {
      throw new Error(
        `no harness output: ${run.stderr.slice(0, 500)} ${run.error}`,
      );
    }

    return JSON.parse(atob(match[1]));
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
}

describe.skipIf(chrome === undefined)("the inspector column height", () => {
  const f = (chrome === undefined ? null : collect()) as {
    closed: Measure;
    open: Measure;
  };

  it("reaches the explorer's bottom with the inspector closed", () => {
    expect(f.closed.inspectorBottom).toBe(f.closed.explorerBottom);
    expect(f.closed.innerBottom).toBe(f.closed.explorerBottom);
    expect(f.closed.explorerBottom).toBe(f.closed.footerTop);
  });

  it("reaches the explorer's bottom with the inspector open", () => {
    expect(f.open.inspectorBottom).toBe(f.open.explorerBottom);
    expect(f.open.innerBottom).toBe(f.open.explorerBottom);
  });
});
