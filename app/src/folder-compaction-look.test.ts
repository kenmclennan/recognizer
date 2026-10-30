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
import { fakeViews } from ${JSON.stringify(here("views-fake.ts"))};
import { fakeWindow } from ${JSON.stringify(here("window-fake.ts"))};
import { parseViewFile } from ${JSON.stringify(here("view-file.ts"))};

window.__fakeWorker = () => {
  const listeners = [];
  return {
    addEventListener: (type, listener) => listeners.push(listener),
    postMessage(request) {
      if (request.cmd !== "layout") return;
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

const ids = [
  "core/data/src/main/kotlin/com/example/A.kt",
  "core/data/src/main/kotlin/com/example/B.kt",
  "core/api/Api.kt",
  "core/api/x/y/Z.kt",
];
const nowScan = {
  commit: "cur1234",
  modules: ids.map((id) => ({ id, kind: "module" })),
  edges: [],
  foreign: [],
};
const loaded = { modules: ids, scans: [{ file: "scan.json", scan: nowScan }], policy: null, notices: [], blocking: null };

const viewText = (steps) => JSON.stringify({ schema_version: 1, description: "d", commit: "cur1234", steps }, null, 2) + "\\n";
const tick = () => new Promise((resolve) => setTimeout(resolve, 40));
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const key = (k) => document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));

function mount(files) {
  const host = document.createElement("div");
  host.style.cssText = "width:1400px;height:800px;display:flex;flex-direction:column";
  document.body.append(host);
  const port = fakeViews(files, {});
  const win = fakeWindow();
  showExplorer(host, loaded, "demo", () => {}, port, () => {}, null, undefined, undefined, undefined, undefined, win);
  const q = (selector) => host.querySelector(selector);
  const all = (selector) => [...host.querySelectorAll(selector)];
  const lastCurrent = () => win.last();
  const frames = () => all(".frame").map((n) => [n.dataset.path, n.querySelector("text").textContent.replace(/ \\d+ of \\d+$/, "")]);
  const rows = () => all(".tree .row.folder").map((n) => [n.dataset.path, n.querySelector(".name").textContent]);
  const boxes = () => all(".box").map((n) => [n.dataset.id, n.dataset.kind, n.querySelector(".name").textContent]);
  return { port, q, all, lastCurrent, frames, rows, boxes };
}

const facts = {};

(async () => {
  await tick();

  const one = mount({});
  await tick();
  click(one.q('.tree .row[data-path="core"] .rcheck'));
  await tick();
  click(one.q('.tree .row[data-path="core"] .name'));
  await tick();
  click(one.q('.tree .row[data-path="core/api"] .name'));
  await tick();
  facts.drawn = { frames: one.frames(), rows: one.rows(), boxes: one.boxes().length };

  click(one.q('.frame-label[data-kind="folder"][data-id="core/data/src/main/kotlin/com/example"]'));
  await tick();
  key("z");
  await tick();
  facts.folded = { current: one.lastCurrent().folded, boxes: one.boxes() };
  key("z");
  await tick();
  key("f");
  await tick();
  facts.focused = { focus: one.lastCurrent().focus, boxes: one.boxes().map((b) => b[0]), frames: one.frames().map((f) => f[0]) };

  const view = mount({
    inner: viewText([
      { kind: "pick", module: "core/data/src/main/kotlin/com/example/A.kt" },
      { kind: "fold", folder: "core/data/src/main" },
    ]),
  });
  await tick();
  click(view.q(".view-list"));
  click(view.q(".view-item"));
  await tick();
  facts.savedView = { folded: view.lastCurrent().folded, boxes: view.boxes() };

  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Facts = ReturnType<typeof JSON.parse>;

async function collect(): Promise<Facts> {
  const dir = mkdtempSync(join(tmpdir(), "folder-compaction-"));

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
    const csp = `${JSON.parse(readFileSync(here("../src-tauri/tauri.conf.json"), "utf8")).app.security.csp}; script-src 'unsafe-inline'`;

    writeFileSync(
      page,
      `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}"><style>${css}</style></head><body><div id="out"></div><span id="module-count"></span><div id="app" style="width:1400px;height:800px;display:flex;flex-direction:column"></div><script>${bundle.replaceAll("</script", "<\\/script")}</script></body></html>`,
    );

    const run = spawnSync(
      chrome as string,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--window-size=1500,900",
        "--virtual-time-budget=30000",
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

describe.skipIf(chrome === undefined)(
  "compacted folders in the explorer",
  () => {
    let f = null as unknown as Facts;

    beforeAll(async () => {
      f = await collect();
    }, 180000);

    it("draws one frame per compacted chain, labelled with the joined path", () => {
      expect(f.drawn.frames).toEqual([
        ["core", "core/"],
        ["core/api", "api/"],
        [
          "core/data/src/main/kotlin/com/example",
          "data/src/main/kotlin/com/example/",
        ],
        ["core/api/x/y", "x/y/"],
      ]);
      expect(f.drawn.boxes).toBe(4);
    });

    it("lists one tree row per compacted chain and none for an inner folder", () => {
      expect(f.drawn.rows.map((row: string[]) => row[0]).sort()).toEqual([
        "core",
        "core/api",
        "core/api/x/y",
        "core/data/src/main/kotlin/com/example",
      ]);
      expect(
        f.drawn.rows.find((row: string[]) => row[0].endsWith("example"))?.[1],
      ).toBe("data/src/main/kotlin/com/example/");
    });

    it("folds a compacted frame into one box with the joined label", () => {
      expect(f.folded.current).toEqual([
        "core/data/src/main/kotlin/com/example",
      ]);
      expect(
        f.folded.boxes.find((box: string[]) => box[1] === "folder"),
      ).toEqual([
        "core/data/src/main/kotlin/com/example",
        "folder",
        "data/src/main/kotlin/com/example/",
      ]);
    });

    it("focuses a compacted frame down to its modules", () => {
      expect(f.focused.focus).toBe("core/data/src/main/kotlin/com/example");
      expect(f.focused.boxes).toEqual([
        "core/data/src/main/kotlin/com/example/A.kt",
        "core/data/src/main/kotlin/com/example/B.kt",
      ]);
      expect(f.focused.frames).toEqual([
        "core/data/src/main/kotlin/com/example",
      ]);
    });

    it("opens a saved view naming an inner folder with the compacted folder folded", () => {
      expect(f.savedView.folded).toEqual([
        "core/data/src/main/kotlin/com/example",
      ]);
    });
  },
);
