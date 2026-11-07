import { beforeAll, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../scripts/pool-scale.mjs";
import { collectFacts, here, webkit } from "./look-page";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { loadedOf, mountExplorer } from ${JSON.stringify(here("look-support.ts"))};

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
const loaded = loadedOf({ modules: scan.modules.map((m) => m.id), scans: [{ file: "scan.json", scan }] });

const app = document.getElementById("app");
mountExplorer({ container: app, loaded, title: "demo", onCount: (text) => { document.getElementById("module-count").textContent = text; } });

const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const key = (k) => document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
const treeRow = (p) => document.querySelector('.tree .row[data-path="' + p + '"]');
const box = (id) => document.querySelector('.box[data-id="' + id + '"]');
const bar = (label) => document.querySelector('.selection-bar [aria-label^="' + label + '"]');
const sectionFigure = (name) => { const h = [...document.querySelectorAll(".inspector-panel .dep-head")].find((n) => n.querySelector(".dep-label").textContent === name); return h ? Number(h.querySelector(".dep-count").textContent) : null; };
const selected = () => [...document.querySelectorAll(".box.selected")].map((n) => n.dataset.id);
const facts = {};

click(treeRow("app").querySelector(".reye"));
click(treeRow("lib").querySelector(".reye"));
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
  return collectFacts<Facts>(HARNESS, "folded-folder", "app");
}

describe.skipIf(webkit === undefined)("a folded folder's box", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = await collect();
  }, scaledTimeout(120000));

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
