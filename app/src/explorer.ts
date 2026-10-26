import {
  buildCanvasGraph,
  type CanvasGraph,
  edgesOf,
  presenceOf,
} from "./canvas-graph";
import { absoluteLayout, toElk } from "./canvas-layout";
import { type Scene, toScene } from "./canvas-scene";
import { createCanvasState, type Selection } from "./canvas-state";
import { buildCanvasView, createMeasure } from "./canvas-view";
import { el } from "./dom";
import {
  describeLine,
  type EvidenceSection,
  evidenceOf,
} from "./edge-evidence";
import { computeHealth, describeTree } from "./health";
import { createLayoutSource, startLayoutWorker } from "./layout-source";
import { createOpenModules } from "./open-modules";
import { repositorySource } from "./repository-source";
import type { Loaded } from "./scan-loading";
import type { BarModel } from "./selection-bar-view";
import { type FilterState, filterTree, isVisible } from "./tree-filter";
import { ancestorFolders, buildTree } from "./tree-model";
import { buildTreeView } from "./tree-view";

export type Explorer = { toggleTree: () => void };

export function showExplorer(
  container: HTMLElement,
  loaded: Loaded,
  title: string,
): Explorer {
  const health = computeHealth(loaded.scans, loaded.policy, loaded.modules);
  const root = buildTree(loaded.modules);
  const described = describeTree(root, health);
  const modules = createOpenModules(loaded.modules);
  const state = createCanvasState(modules);
  const measure = createMeasure();
  const scans = loaded.scans.map(({ scan }) => scan);
  const expanded = new Set<string>();
  const filter: FilterState = {
    text: "",
    onCanvas: false,
    needsAttention: false,
  };
  let treeHidden = false;
  let scrollTarget: string | null = null;
  let graph: CanvasGraph = emptyGraph();
  let scene: Scene | null = null;
  let titles = new Map<string, string>();
  let evidence: { id: string; sections: EvidenceSection[] } | null = null;
  let layoutNotice: string | null = null;

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
      changed();
    },
    takeOff(id) {
      modules.close(id);
      changed();
    },
    find,
    findFolder(path) {
      select({ kind: "folder", id: path });
      canvas.centerOn(path);
    },
    hideTree: toggleTree,
  });

  const canvas = buildCanvasView({
    find,
    select,
    takeOff() {
      state.takeOff(state.selection());
      changed();
    },
    toggleFold() {
      const selection = state.selection();

      if (selection?.kind === "folder") {
        state.toggleFold(selection.id);
        changed();
      }
    },
    toggleFocus() {
      const selection = state.selection();

      if (selection?.kind === "folder") {
        state.toggleFocus(selection.id);
        changed();
        canvas.centerOn(state.focus() ?? selection.id);
      }
    },
    clear() {
      state.clear();
      changed();
    },
    setShowInferred(show) {
      state.setShowInferred(show);
      changed();
    },
    toggleTree,
    measure,
  });

  const layout = createLayoutSource(
    startLayoutWorker(),
    (result) => {
      layoutNotice = null;
      scene = toScene(graph, absoluteLayout(result));
      render();
    },
    (message) => {
      layoutNotice = `Layout failed: ${message}`;
      render();
    },
  );

  const notices = el("div", "notices");

  notices.setAttribute("role", "status");

  const body = el("div", "explorer");

  body.append(tree.element, canvas.element);
  container.replaceChildren(notices, body);

  function emptyGraph(): CanvasGraph {
    return buildCanvasGraph({
      scans: [],
      modules: [],
      opened: [],
      disc: () => "grey",
      folded: new Set(),
      focus: null,
      showInferred: true,
    });
  }

  function renderNotices() {
    notices.replaceChildren(
      ...[...loaded.notices, ...health.notices].map((text) =>
        el("p", "notice-line", text),
      ),
    );
    notices.hidden = notices.childElementCount === 0;
  }

  function changed() {
    graph = buildCanvasGraph({
      scans,
      modules: loaded.modules,
      opened: modules.opened(),
      disc: (path) => described.get(path)?.disc ?? "grey",
      folded: state.folded(),
      focus: state.focus(),
      showInferred: state.showInferred(),
    });
    state.reconcile(presenceOf(graph));
    titles = new Map(
      graph.lines.map((line) => [line.id, describeLine(line.edges)]),
    );
    layout.request(toElk(graph, measure));
    render();
  }

  function reveal(selection: Selection) {
    if (selection === null || selection.kind === "edge") {
      return;
    }

    const visible =
      selection.kind === "folder" ||
      isVisible(filterTree(root, filter, context), selection.id);

    if (visible) {
      for (const folder of ancestorFolders(selection.id)) {
        expanded.add(folder);
      }

      scrollTarget = selection.id;
    }
  }

  function select(selection: Selection) {
    state.select(selection);
    evidence = null;
    reveal(selection);

    if (selection?.kind === "edge") {
      void loadEvidence(selection.id);
    }

    render();
  }

  async function loadEvidence(id: string) {
    const line = graph.lines.find((candidate) => candidate.id === id);

    if (!line) {
      return;
    }

    const sections = await Promise.all(
      line.edges.map(async (edge) =>
        evidenceOf(
          edge,
          await repositorySource
            .sourceLine(edge.from, edge.line)
            .catch(() => null),
        ),
      ),
    );

    if (state.selection()?.id === id) {
      evidence = { id, sections };
      render();
    }
  }

  function boxFor(id: string): string {
    return (
      graph.boxes.find(
        (box) =>
          box.id === id ||
          (box.kind === "folder" && id.startsWith(`${box.id}/`)),
      )?.id ?? id
    );
  }

  function find(id: string) {
    state.select({ kind: "module", id });
    evidence = null;
    reveal({ kind: "module", id });
    render();
    canvas.centerOn(boxFor(id));
  }

  function toggleTree() {
    treeHidden = !treeHidden;
    render();
  }

  function barOf(selection: Selection): BarModel | null {
    if (selection === null || selection.kind === "edge") {
      return null;
    }

    const counts = graph.counts(selection);

    return {
      kind: selection.kind,
      uses: counts.uses,
      usedBy: counts.usedBy,
      files:
        selection.kind === "folder"
          ? { open: graph.openIn(selection.id), held: graph.held(selection.id) }
          : null,
      focused: state.focus() === selection.id,
      folded: state.folded().has(selection.id),
    };
  }

  function render() {
    const filtered = filterTree(root, filter, context);
    const selection = state.selection();

    body.classList.toggle("tree-hidden", treeHidden);
    tree.render({
      title,
      moduleCount: loaded.modules.length,
      filtered,
      described,
      expanded,
      selected:
        selection === null || selection.kind === "edge" ? null : selection.id,
      isOpen: modules.isOpen,
      filter,
    });
    canvas.render({
      scene,
      selection,
      highlight: edgesOf(graph, selection),
      bar: barOf(selection),
      titles,
      evidence,
      open: modules.count(),
      total: modules.total(),
      treeHidden,
      showInferred: state.showInferred(),
      notice: layoutNotice,
    });

    if (scrollTarget !== null) {
      tree.scrollTo(scrollTarget);
      scrollTarget = null;
    }
  }

  renderNotices();
  changed();

  return { toggleTree };
}
