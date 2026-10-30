import { beforeAll, describe, expect, it } from "vitest";
import { chrome, collectFacts, here } from "./look-page";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { buildSelectionBar } from ${JSON.stringify(here("selection-bar-view.ts"))};
import { buildInspectorView } from ${JSON.stringify(here("inspector-view.ts"))};
import { inspectorContent } from ${JSON.stringify(here("inspector-model.ts"))};
import { compactFolders } from ${JSON.stringify(here("folder-compaction.ts"))};
import { filterTree } from ${JSON.stringify(here("tree-filter.ts"))};
import { buildTree } from ${JSON.stringify(here("tree-model.ts"))};
import { buildTreeView } from ${JSON.stringify(here("tree-view.ts"))};

const calls = [];
const cs = (node) => getComputedStyle(node);
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const describe = (node) => node && ({
  title: node.title,
  aria: node.getAttribute("aria-label"),
  svgs: node.querySelectorAll("svg").length,
  path: node.querySelector("path") && node.querySelector("path").getAttribute("d"),
  width: Math.round(node.getBoundingClientRect().width),
  text: node.textContent,
});
const facts = {};
const EDITOR = "Open in Editor (⌘⇧E)";

const barActions = { openTab() {}, toggleFocus() {}, toggleFold() {}, openContents() {}, takeOff() {}, openInEditor: () => calls.push("bar") };
const bar = buildSelectionBar(barActions);
document.body.append(bar.element);
bar.element.hidden = false;
const model = (kind) => ({ kind, dependencies: 2, files: kind === "folder" ? { open: 1, held: 2 } : null, focused: false, folded: false, inspectorTab: null });
bar.render(model("module"));
facts.barModule = describe(bar.element.querySelector('[aria-label="' + EDITOR + '"]'));
bar.render(model("folder"));
const barFolder = bar.element.querySelector('[aria-label="' + EDITOR + '"]');
facts.barFolder = describe(barFolder);
facts.barOrder = [...bar.element.children].map((c) => c.getAttribute("aria-label") || "|");
click(barFolder);

const scan = { modules: [{ id: "p/m.py", kind: "module" }, { id: "p/q.py", kind: "module" }], edges: [], foreign: [], calls: [] };
const inputs = {
  scans: [scan], modules: scan.modules.map((m) => m.id), compaction: compactFolders(scan.modules.map((m) => m.id)), disc: () => "green", findings: () => [], onCanvas: () => true,
  expanded: new Set(), tab: "contents", evidence: null, edgeOnCanvas: true, counts: () => ({ uses: 0, usedBy: 0 }), filter: "", collapsed: new Set(), responsibility: () => ({ state: { kind: "missing" }, busy: false, failure: null }),
};
const inspectorActions = { open() {}, close() {}, setTab() {}, toggleFold() {}, openFile() {}, hover() {}, putOnCanvas() {}, takeOff() {}, pickName() {}, toggleGroup() {}, setFilter() {}, openInEditor: (target) => calls.push("inspector:" + target.kind + ":" + target.id) };
const inspect = (selection) => {
  const view = buildInspectorView(inspectorActions);
  const host = document.createElement("div");
  host.style.cssText = "width:340px;display:flex;flex-direction:column";
  document.body.append(host);
  host.append(view.element);
  view.render(inspectorContent(selection, inputs), true);
  return view.element.querySelector(".ih");
};
const moduleHead = inspect({ kind: "module", id: "p/m.py" });
facts.inspectorModule = describe(moduleHead.querySelector('[aria-label="' + EDITOR + '"]'));
facts.inspectorOrder = [...moduleHead.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
click(moduleHead.querySelector('[aria-label="' + EDITOR + '"]'));
const folderHead = inspect({ kind: "folder", id: "p" });
facts.inspectorFolder = describe(folderHead.querySelector('[aria-label="' + EDITOR + '"]'));
click(folderHead.querySelector('[aria-label="' + EDITOR + '"]'));
facts.inspectorEdge = inspect({ kind: "edge", id: "p/m.py>p/q.py" }).querySelectorAll('[aria-label="' + EDITOR + '"]').length;

const root = buildTree(["p/m.py", "p/q.py"]);
const filter = { text: "", onCanvas: false, needsAttention: false };
const context = { isOpen: () => false, disc: () => "grey" };
const tree = buildTreeView({
  setText() {}, toggleOnCanvas() {}, toggleNeedsAttention() {}, toggleFolder() {}, putOnCanvas() {}, takeOff() {},
  putFolderOnCanvas() {}, takeFolderOff() {}, find() {}, openFolderInEditor: () => calls.push("tree"),
});
document.body.append(tree.element);
tree.render({ title: "shop", moduleCount: 2, filtered: filterTree(root, filter, context), described: new Map(), expanded: new Set(), selected: null, isOpen: context.isOpen, filter });
const treeButton = tree.element.querySelector(".tree-header button");
facts.tree = describe(treeButton);
const header = tree.element.querySelector(".tree-header");
facts.treeRightEdge = Math.round(header.getBoundingClientRect().right - treeButton.getBoundingClientRect().right);
click(treeButton);
facts.calls = calls;

document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
`;

type Facts = ReturnType<typeof JSON.parse>;

const EDITOR = "Open in Editor (⌘⇧E)";
const FOLDER = "Open Folder in Editor (⌘⇧O)";

describe.skipIf(chrome === undefined)("the Open in Editor icons", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = await collectFacts<Facts>(HARNESS, "editor-icons-look");
  }, 180000);

  it("is in the selection bar for a module and a folder, after Contents", () => {
    for (const icon of [f.barModule, f.barFolder]) {
      expect(icon.title).toBe(EDITOR);
      expect(icon.aria).toBe(EDITOR);
      expect(icon.svgs).toBe(1);
      expect(icon.text).toBe("");
    }

    expect(f.barOrder.slice(-4)).toEqual([
      "Contents (I)",
      EDITOR,
      "|",
      "Take off the canvas (Backspace)",
    ]);
  });

  it("is in the inspector header for a module and a folder, before the close button, and absent on an edge", () => {
    expect(f.inspectorModule.title).toBe(EDITOR);
    expect(f.inspectorModule.svgs).toBe(1);
    expect(f.inspectorFolder.title).toBe(EDITOR);
    expect(f.inspectorOrder).toEqual([EDITOR, "Close the inspector"]);
    expect(f.inspectorEdge).toBe(0);
  });

  it("is in the tree header as Open Folder in Editor, at the right edge", () => {
    expect(f.tree.title).toBe(FOLDER);
    expect(f.tree.aria).toBe(FOLDER);
    expect(f.tree.svgs).toBe(1);
    expect(f.treeRightEdge).toBeLessThan(16);
  });

  it("uses the same glyph in all three places", () => {
    expect(f.barModule.path).toBe(f.inspectorModule.path);
    expect(f.tree.path).toBe(f.barModule.path);
  });

  it("calls the matching action on click", () => {
    expect(f.calls).toEqual([
      "bar",
      "inspector:module:p/m.py",
      "inspector:folder:p",
      "tree",
    ]);
  });
});
