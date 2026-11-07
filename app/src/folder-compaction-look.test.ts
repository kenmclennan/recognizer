import { beforeAll, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../scripts/pool-scale.mjs";
import { collectFacts, here, webkit } from "./look-page";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { loadedOf, mountExplorer } from ${JSON.stringify(here("look-support.ts"))};
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
const loaded = loadedOf({ modules: ids, scans: [{ file: "scan.json", scan: nowScan }] });

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
  mountExplorer({ container: host, loaded, title: "demo", views: port, post: () => null, windowPort: win });
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
  click(one.q('.tree .row[data-path="core"] .reye'));
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
  return collectFacts<Facts>(HARNESS, "folder-compaction", "light", "app");
}

describe.skipIf(webkit === undefined)(
  "compacted folders in the explorer",
  () => {
    let f = null as unknown as Facts;

    beforeAll(async () => {
      f = await collect();
    }, scaledTimeout(180000));

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
