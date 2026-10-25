import { buildCanvasView } from "./canvas-view";
import { el } from "./dom";
import { computeHealth, describeTree } from "./health";
import { createOpenModules } from "./open-modules";
import type { Loaded } from "./scan-loading";
import { type FilterState, filterTree, isVisible } from "./tree-filter";
import { ancestorFolders, buildTree } from "./tree-model";
import { buildTreeView } from "./tree-view";

export type Explorer = { toggleTree: () => void };

export function showExplorer(container: HTMLElement, loaded: Loaded): Explorer {
  const health = computeHealth(loaded.scans, loaded.policy, loaded.modules);
  const root = buildTree(loaded.modules);
  const described = describeTree(root, health);
  const modules = createOpenModules(loaded.modules);
  const expanded = new Set<string>();
  const filter: FilterState = {
    text: "",
    onCanvas: false,
    needsAttention: false,
  };
  let treeHidden = false;
  let scrollTarget: string | null = null;

  const context = {
    isOpen: modules.isOpen,
    disc: (id: string) => described.get(id)?.disc ?? "grey",
  };

  const tree = buildTreeView({
    setText(text) {
      filter.text = text;
      render();
    },
    toggleOnCanvas() {
      filter.onCanvas = !filter.onCanvas;
      render();
    },
    toggleNeedsAttention() {
      filter.needsAttention = !filter.needsAttention;
      render();
    },
    toggleFolder(path) {
      if (!expanded.delete(path)) {
        expanded.add(path);
      }

      render();
    },
    putOnCanvas(id) {
      modules.open(id);
      render();
    },
    takeOff(id) {
      modules.close(id);
      render();
    },
    find,
  });

  const canvas = buildCanvasView({
    find,
    takeOff: (id) => {
      modules.close(id);
      render();
    },
    toggleTree,
  });

  const notices = el("div", "notices");

  notices.setAttribute("role", "status");
  notices.replaceChildren(
    ...[...loaded.notices, ...health.notices].map((text) =>
      el("p", "notice-line", text),
    ),
  );
  notices.hidden = notices.childElementCount === 0;

  const body = el("div", "explorer");

  body.append(tree.element, canvas.element);
  container.replaceChildren(notices, body);

  function find(id: string) {
    modules.select(id);

    if (isVisible(filterTree(root, filter, context), id)) {
      for (const folder of ancestorFolders(id)) {
        expanded.add(folder);
      }

      scrollTarget = id;
    }

    render();
  }

  function toggleTree() {
    treeHidden = !treeHidden;
    render();
  }

  function render() {
    const filtered = filterTree(root, filter, context);

    body.classList.toggle("tree-hidden", treeHidden);
    tree.render({
      filtered,
      described,
      expanded,
      selected: modules.selected(),
      isOpen: modules.isOpen,
      filter,
    });
    canvas.render({
      opened: modules.opened(),
      total: modules.total(),
      selected: modules.selected(),
      treeHidden,
    });

    if (scrollTarget !== null) {
      tree.scrollTo(scrollTarget);
      scrollTarget = null;
    }
  }

  render();

  return { toggleTree };
}
