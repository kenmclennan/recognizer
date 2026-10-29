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
import { build } from "vite";
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
const SRC = fileURLToPath(new URL(".", import.meta.url));

const ENTRY = `
import { mountPanelResizers } from ${JSON.stringify(join(SRC, "panel-resizer-view.ts"))};

const memory = new Map();
const storage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => memory.set(key, value),
};

function mount(host) {
  host.innerHTML =
    '<nav class="rail"></nav><aside class="tree"></aside><main class="canvas"></main><aside class="inspector open"><div class="inspector-panel"></div></aside>';
  mountPanelResizers(
    host,
    { tree: host.querySelector(".tree"), inspector: host.querySelector(".inspector") },
    storage,
  );
  host.classList.add("inspector-open");
}

const widthOf = (host, selector) => host.querySelector(selector).getBoundingClientRect().width;

function drag(host, selector, dx) {
  const node = host.querySelector(selector);
  node.setPointerCapture = () => {};
  node.releasePointerCapture = () => {};
  const fire = (type, x) =>
    node.dispatchEvent(new PointerEvent(type, { pointerId: 1, clientX: x, bubbles: true }));
  fire("pointerdown", 500);
  fire("pointermove", 500 + dx);
  fire("pointerup", 500 + dx);
}

const report = {};
const first = document.getElementById("first");
const second = document.getElementById("second");

mount(first);
report.initial = { tree: widthOf(first, ".tree"), inspector: widthOf(first, ".inspector") };
drag(first, ".panel-resizer-tree", 50);
report.treeRight = widthOf(first, ".tree");
drag(first, ".panel-resizer-tree", 5000);
report.treeMax = widthOf(first, ".tree");
drag(first, ".panel-resizer-tree", -5000);
report.treeMin = widthOf(first, ".tree");
drag(first, ".panel-resizer-inspector", -60);
report.inspectorLeft = widthOf(first, ".inspector");
drag(first, ".panel-resizer-inspector", -5000);
report.inspectorMax = widthOf(first, ".inspector");
drag(first, ".panel-resizer-inspector", 5000);
report.inspectorMin = widthOf(first, ".inspector");
drag(first, ".panel-resizer-tree", 5000);
drag(first, ".panel-resizer-inspector", -90);
report.saved = memory.get("recognizer.panel-widths");

mount(second);
report.reopened = { tree: widthOf(second, ".tree"), inspector: widthOf(second, ".inspector") };

localStorage.setItem("recognizer.panel-widths", JSON.stringify({ tree: 222, inspector: 333 }));
report.realStorage = JSON.parse(localStorage.getItem("recognizer.panel-widths"));

document.body.insertAdjacentHTML("beforeend", "<pre id='out'></pre>");
document.getElementById("out").textContent = JSON.stringify(report);
`;

const PAGE = (css: string) => `<!doctype html>
<html><head><meta charset="utf-8"><style>${css}</style></head><body>
<div style="display:flex;flex-direction:column;width:1400px;height:500px">
<div class="explorer" id="first"></div>
</div>
<div style="display:flex;flex-direction:column;width:1400px;height:500px">
<div class="explorer" id="second"></div>
</div>
<script src="look.js"></script></body></html>`;

type Report = {
  initial: { tree: number; inspector: number };
  treeRight: number;
  treeMax: number;
  treeMin: number;
  inspectorLeft: number;
  inspectorMax: number;
  inspectorMin: number;
  saved: string;
  reopened: { tree: number; inspector: number };
  realStorage: { tree: number; inspector: number };
};

async function run(): Promise<Report> {
  const entryDir = mkdtempSync(join(tmpdir(), "resize-entry-"));
  const dir = mkdtempSync(join(tmpdir(), "resize-look-"));

  try {
    writeFileSync(join(entryDir, "entry.ts"), ENTRY);

    await build({
      configFile: false,
      logLevel: "silent",
      root: fileURLToPath(new URL("..", import.meta.url)),
      build: {
        outDir: dir,
        emptyOutDir: false,
        minify: false,
        lib: {
          entry: join(entryDir, "entry.ts"),
          name: "Look",
          formats: ["iife"],
          fileName: () => "look.js",
        },
      },
    });

    writeFileSync(
      join(dir, "page.html"),
      PAGE(readFileSync(join(SRC, "style.css"), "utf8")),
    );

    const result = spawnSync(
      chrome as string,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        `--user-data-dir=${join(dir, "profile")}`,
        "--allow-file-access-from-files",
        "--dump-dom",
        `file://${join(dir, "page.html")}`,
      ],
      { encoding: "utf8", timeout: 60000 },
    );
    const match = /<pre id="out">([\s\S]*?)<\/pre>/.exec(result.stdout);

    if (!match) {
      throw new Error(
        `no report from the page: ${result.stderr.slice(0, 400)}`,
      );
    }

    return JSON.parse((match[1] as string).replaceAll("&quot;", '"')) as Report;
  } finally {
    rmSync(entryDir, { recursive: true, force: true, maxRetries: 10 });
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
}

describe("resizing the side panels in a real browser", () => {
  it.skipIf(chrome === undefined)(
    "drags each inner edge within its limits and reopens at the saved widths",
    async () => {
      const report = await run();

      expect(report.initial).toEqual({ tree: 280, inspector: 340 });
      expect(report.treeRight).toBe(330);
      expect(report.treeMax).toBe(480);
      expect(report.treeMin).toBe(200);
      expect(report.inspectorLeft).toBe(400);
      expect(report.inspectorMax).toBe(640);
      expect(report.inspectorMin).toBe(280);
      expect(JSON.parse(report.saved)).toEqual({ tree: 480, inspector: 370 });
      expect(report.reopened).toEqual({ tree: 480, inspector: 370 });
      expect(report.realStorage).toEqual({ tree: 222, inspector: 333 });
    },
    120000,
  );
});
