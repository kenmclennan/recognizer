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
import { buildCanvasView } from ${JSON.stringify(join(SRC, "canvas-view.ts"))};
import { createPicker } from ${JSON.stringify(join(SRC, "picker-model.ts"))};

const edge = (from, to, names) => ({ from, to, kind: "depends", line: 1, names });
const scan = {
  modules: ["a.py", "b.py", "c.py", "d.py"].map((id) => ({ id, kind: "module" })),
  edges: [edge("b.py", "a.py", ["save"]), edge("c.py", "a.py", ["save"]), edge("d.py", "a.py", ["save"])],
  foreign: [],
};
const noop = () => {};
const actions = {
  find: noop, select: noop, takeOff: noop, toggleFold: noop, toggleFocus: noop,
  clear: noop, setShowInferred: noop, toggleTree: noop, measure: (t) => t.length * 7,
  togglePicker: noop, closePicker: noop, untick: noop, openContents: noop,
  disc: () => "green",
  picker: { toggle: noop, toggleGroup: noop, toggleCollapse: noop, setTab: noop, setFilter: noop, tickAll: noop, add: noop },
};
const view = buildCanvasView(actions);
const body = document.getElementById("explorer");
body.insertBefore(view.element, document.getElementById("inspector"));
const model = createPicker({
  scans: [scan],
  modules: scan.modules.map((m) => m.id),
  onCanvas: () => false,
  source: { kind: "list", items: ["b.py", "c.py", "d.py"].map((id) => ({ id, names: ["save"] })), title: "calls save" },
});
const props = (anchor) => ({
  scene: null, selection: { kind: "module", id: "a.py" }, highlight: null, bar: null,
  titles: new Map(), open: 1, total: 4, treeHidden: true, showInferred: true,
  notice: null, picker: { model, anchor },
});
const results = [];
const measure = (label) => {
  const picker = document.querySelector(".picker").getBoundingClientRect();
  const panel = document.getElementById("inspector").getBoundingClientRect();
  const add = document.querySelector(".picker-add").getBoundingClientRect();
  const hit = document.elementFromPoint(add.left + add.width / 2, add.top + add.height / 2);
  results.push({
    label,
    pickerRight: picker.right,
    inspectorLeft: panel.left,
    addCovered: hit !== document.querySelector(".picker-add"),
  });
};
body.classList.add("inspector-open");
const stage = document.querySelector(".stage").getBoundingClientRect();
for (const [label, anchor] of [
  ["unanchored", null],
  ["anchored at the inspector's left edge", { x: stage.width - 20, y: 60 }],
]) {
  view.render(props(anchor));
  measure(label);
}
view.render(props({ x: 40, y: 60 }));
body.classList.remove("inspector-open");
view.render(props({ x: 40, y: 60 }));
body.classList.add("inspector-open");
view.render(props({ x: 40, y: 60 }));
measure("opened while the canvas was wide");
document.body.insertAdjacentHTML("beforeend", "<pre id='out'></pre>");
document.getElementById("out").textContent = JSON.stringify(results);
`;

const PAGE = (css: string) => `<!doctype html>
<html><head><meta charset="utf-8"><style>${css}</style></head><body>
<div style="display:flex;flex-direction:column;width:700px;height:600px">
<div class="explorer tree-hidden" id="explorer">
<aside class="inspector" id="inspector"><div class="inspector-panel" id="panel">panel</div></aside>
</div></div>
<script src="look.js"></script></body></html>`;

type Result = {
  label: string;
  pickerRight: number;
  inspectorLeft: number;
  addCovered: boolean;
};

async function run(): Promise<Result[]> {
  const entryDir = mkdtempSync(join(tmpdir(), "picker-inspector-entry-"));
  const dir = mkdtempSync(join(tmpdir(), "picker-inspector-"));

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

    const output = spawnSync(
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
    const match = /<pre id="out">([\s\S]*?)<\/pre>/.exec(output.stdout);

    if (!match) {
      throw new Error(
        `no report from the page: ${output.stderr.slice(0, 400)}`,
      );
    }

    return JSON.parse(
      (match[1] as string).replaceAll("&quot;", '"').replaceAll("&amp;", "&"),
    ) as Result[];
  } finally {
    rmSync(entryDir, { recursive: true, force: true, maxRetries: 10 });
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
}

describe("a picker opened with the inspector open, in a real browser", () => {
  it.skipIf(chrome === undefined)(
    "stays left of the inspector with its Add button uncovered",
    async () => {
      const results = await run();

      expect(results.length).toBe(3);

      for (const result of results) {
        expect(result.pickerRight, result.label).toBeLessThanOrEqual(
          result.inspectorLeft,
        );
        expect(result.addCovered, result.label).toBe(false);
      }
    },
    120000,
  );
});
