import { beforeAll, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../scripts/pool-scale.mjs";
import { chrome, collectFacts, here } from "./look-page";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { buildInspectorView } from ${JSON.stringify(here("inspector-view.ts"))};
import { inspectorContent } from ${JSON.stringify(here("inspector-model.ts"))};
import { compactFolders } from ${JSON.stringify(here("folder-compaction.ts"))};
import { filterTree } from ${JSON.stringify(here("tree-filter.ts"))};
import { buildTree } from ${JSON.stringify(here("tree-model.ts"))};
import { buildTreeView } from ${JSON.stringify(here("tree-view.ts"))};

const LONG = "pkg/" + "deeply/".repeat(8) + "described.py";
const LINES = { [LONG]: "Reads the configuration and hands each section to the part that owns it, " + "wrapping onto several lines. ".repeat(4) };
const ids = ["pkg/a.py", LONG, "pkg/plain.py"];
const scan = {
  modules: ids.map((id) => ({ id, kind: "module" })),
  edges: [
    { from: "pkg/a.py", to: LONG, kind: "depends", line: 1, names: ["X"] },
    { from: "pkg/a.py", to: "pkg/plain.py", kind: "depends", line: 2, names: ["Y"] },
  ],
  foreign: [],
  calls: [],
};
const lineOf = (id) => LINES[id] ? { kind: "current", line: LINES[id] } : { kind: "missing" };
const inputs = {
  scans: [scan], modules: ids, compaction: compactFolders(ids), disc: () => "green", findings: () => [], findingRows: () => [], onCanvas: () => false,
  expanded: new Set(), showPrivate: true, tab: "dependencies", counts: () => ({ uses: 2, usedBy: 0 }), filter: "", followed: null, metrics: [],
  responsibility: (id) => ({ state: lineOf(id), failure: null }),
};
const actions = { open() {}, close() {}, setTab() {}, toggleFold() {}, openFile() {}, hover() {}, putOnCanvas() {}, takeOff() {}, pickName() {}, toggleGroup() {}, setFilter() {}, openInEditor() {}, setShowPrivate() {}, follow() {}, focusedFinding: () => null, moduleAbsent: () => false };

const enter = (node) => node.dispatchEvent(new MouseEvent("mouseenter"));
const leave = (node) => node.dispatchEvent(new MouseEvent("mouseleave"));
const read = (node) => {
  enter(node);
  const tip = document.querySelector(".module-tip");
  const box = tip.getBoundingClientRect();
  const result = {
    path: tip.querySelector(".module-tip-path")?.textContent ?? null,
    description: tip.querySelector(".module-tip-description")?.textContent ?? null,
    mono: getComputedStyle(tip.querySelector(".module-tip-path")).fontFamily,
    width: box.width,
    left: box.left,
    right: box.right,
    viewport: window.innerWidth,
    nativeTitle: node.title,
    count: document.querySelectorAll(".module-tip").length,
  };
  leave(node);
  result.after = document.querySelectorAll(".module-tip").length;
  return result;
};
const facts = {};

const host = document.createElement("div");
host.style.cssText = "position:absolute;right:0;top:0;width:340px;height:700px;display:flex;flex-direction:column";
document.body.append(host);
const view = buildInspectorView(actions);
host.append(view.element);
view.render(inspectorContent({ kind: "module", id: "pkg/a.py" }, inputs), true);
const rowFor = (root, id) => [...root.querySelectorAll(".row")].find((r) => r.dataset.id === id || r.dataset.path === id);
facts.dependencies = {
  described: read(rowFor(view.element, LONG)),
  plain: read(rowFor(view.element, "pkg/plain.py")),
};

const tree = buildTreeView({
  setText() {}, toggleOnCanvas() {}, toggleNeedsAttention() {}, toggleFolder() {}, putOnCanvas() {}, takeOff() {},
  putFolderOnCanvas() {}, takeFolderOff() {}, find() {}, openFolderInEditor() {},
});
tree.element.style.cssText = "position:absolute;left:0;top:0;width:260px;height:700px";
document.body.append(tree.element);
const filter = { text: "", onCanvas: false, needsAttention: false };
const context = { isOpen: () => false, disc: () => "grey" };
const expanded = new Set(["pkg", "pkg/deeply", ...Array.from({ length: 8 }, (_, i) => "pkg/" + "deeply/".repeat(i + 1).slice(0, -1))]);
tree.render({ title: "shop", moduleCount: 3, filtered: filterTree(buildTree(ids), filter, context), described: new Map(), description: (id) => LINES[id] ?? null, expanded, selected: null, isOpen: context.isOpen, filter });
facts.tree = {
  described: read(rowFor(tree.element, LONG)),
  plain: read(rowFor(tree.element, "pkg/plain.py")),
  folderTitle: rowFor(tree.element, "pkg").title,
};
facts.folder = (() => {
  const folder = rowFor(view.element, "pkg");
  return folder ? folder.title : null;
})();

document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
`;

type Facts = ReturnType<typeof JSON.parse>;

describe.skipIf(chrome === undefined)("the module hover tip", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = await collectFacts<Facts>(HARNESS, "module-tip-look");
  }, scaledTimeout(180000));

  for (const place of ["dependencies", "tree"] as const) {
    it(`shows the path and description in the ${place}`, () => {
      const tip = f[place].described;

      expect(tip.path).toContain("described.py");
      expect(tip.description).toContain("Reads the configuration");
      expect(tip.mono).toMatch(/monospace/);
      expect(tip.nativeTitle).toBe("");
      expect(tip.count).toBe(1);
      expect(tip.after).toBe(0);
    });

    it(`shows the path alone for a module without one in the ${place}`, () => {
      const tip = f[place].plain;

      expect(tip.path).toBe("pkg/plain.py");
      expect(tip.description).toBeNull();
      expect(tip.nativeTitle).toBe("");
    });

    it(`wraps within about 340px and stays inside the window in the ${place}`, () => {
      const tip = f[place].described;

      expect(tip.width).toBeLessThanOrEqual(342);
      expect(tip.left).toBeGreaterThanOrEqual(0);
      expect(tip.right).toBeLessThanOrEqual(tip.viewport);
    });
  }

  it("leaves a folder row with its native title", () => {
    expect(f.folder).toBe("pkg/");
    expect(f.tree.folderTitle).toBe("");
  });
});
