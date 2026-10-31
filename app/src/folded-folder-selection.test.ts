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
  edges: [{ from: "lib/c.py", to: "app/a.py", kind: "depends", line: 1, names: ["A"] }, edge("app/a.py", ["A"]), edge("lib/c.py", ["C"]), edge("lib/d.py", ["D"]), edge("lib/e.py", ["E"])],
  foreign: [],
};
const loaded = { modules: scan.modules.map((m) => m.id), scans: [{ file: "scan.json", scan }], policy: null, notices: [], blocking: null, findings: [], sensors: [] };

const app = document.getElementById("app");
showExplorer(app, loaded, "demo", (text) => { document.getElementById("module-count").textContent = text; });

const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const key = (k) => document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
const treeRow = (p) => document.querySelector('.tree .row[data-path="' + p + '"]');
const box = (id) => document.querySelector('.box[data-id="' + id + '"]');
const bar = (label) => document.querySelector('.selection-bar [aria-label^="' + label + '"]');
const sectionFigure = (name) => { const h = [...document.querySelectorAll(".inspector-panel .ofold")].find((n) => n.textContent.startsWith(name)); return h ? Number(h.textContent.replace(/\\D+/g, "")) : null; };
const selected = () => [...document.querySelectorAll(".box.selected")].map((n) => n.dataset.id);
const facts = {};

click(treeRow("app").querySelector(".rcheck"));
click(treeRow("lib").querySelector(".rcheck"));
click(document.querySelector('.frame-label[data-id="lib"]'));
key("z");
facts.foldedKind = box("lib") && box("lib").dataset.kind;
click(box("lib").querySelector(".box-body"));
facts.selected = selected();
const unfold = document.querySelector('.selection-bar [aria-label="Unfold (Z)"]');
facts.unfoldLabel = unfold ? unfold.getAttribute("aria-label") : null;
facts.total = Number(bar("Dependencies").textContent);
click(bar("Dependencies"));
facts.uses = sectionFigure("Uses");
facts.usedBy = sectionFigure("Used by");
key("z");
facts.boxAfterZ = box("lib") === null;
key("z");
click(box("lib").querySelector(".box-body"));
click(document.querySelector('.selection-bar [aria-label="Unfold (Z)"]'));
facts.boxAfterUnfold = box("lib") === null;

document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
`;

type Facts = {
  foldedKind: string | null;
  selected: string[];
  unfoldLabel: string | null;
  total: number;
  uses: number | null;
  usedBy: number | null;
  boxAfterZ: boolean;
  boxAfterUnfold: boolean;
};

async function collect(): Promise<Facts> {
  const dir = mkdtempSync(join(tmpdir(), "folded-folder-"));

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

describe.skipIf(chrome === undefined)("a folded folder's box", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = await collect();
  }, 120000);

  it("selects the folder, not a module", () => {
    expect(f.foldedKind).toBe("folder");
    expect(f.selected).toEqual(["lib"]);
  });

  it("shows the folder's bar with Unfold and the edges crossing its boundary", () => {
    expect(f.unfoldLabel).toBe("Unfold (Z)");
    expect(f.total).toBe((f.uses ?? 0) + (f.usedBy ?? 0));
    expect(f.uses).toBeGreaterThan(0);
    expect(f.usedBy).toBeGreaterThan(0);
  });

  it("opens again on Z and on Unfold", () => {
    expect(f.boxAfterZ).toBe(true);
    expect(f.boxAfterUnfold).toBe(true);
  });
});
