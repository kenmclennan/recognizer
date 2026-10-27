import {
  buildCanvasGraph,
  type CanvasGraph,
  edgesOf,
  neighbourhoodOf,
  presenceOf,
} from "./canvas-graph";
import { absoluteLayout, type Point, toElk } from "./canvas-layout";
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
import {
  emphasisedLines,
  type InspectorTab,
  inspectorContent,
} from "./inspector-model";
import { buildInspectorView } from "./inspector-view";
import {
  createLayoutSource,
  layoutOnMainThread,
  startLayoutWorker,
} from "./layout-source";
import { buildCallerIndex } from "./member-callers";
import { createOpenModules } from "./open-modules";
import { createPicker, type PickerModel } from "./picker-model";
import { repositorySource } from "./repository-source";
import type { Loaded } from "./scan-loading";
import type { BarModel, PickerKind } from "./selection-bar-view";
import { type FilterState, filterTree, isVisible } from "./tree-filter";
import { ancestorFolders, buildTree } from "./tree-model";
import { buildTreeView } from "./tree-view";

export type Explorer = {
  toggleTree: () => void;
  openPickerOn: (
    items: { id: string; names?: string[] }[],
    title: string,
    anchor?: Point,
  ) => void;
};

type OpenPicker = {
  model: PickerModel;
  kind: PickerKind | "list";
  selection: Selection;
  anchor: Point | null;
};

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
  let inspectorOpen = false;
  let inspectorTab: InspectorTab = "contents";
  let hovered: string | null = null;
  const folds = new Set<string>();
  const callers = buildCallerIndex(scans);
  let layoutNotice: string | null = null;
  let picker: OpenPicker | null = null;

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
    openContents() {
      inspectorOpen = true;
      inspectorTab = "contents";
      render();
    },
    measure,
    disc: (id) => described.get(id)?.disc ?? "grey",
    togglePicker,
    closePicker() {
      closePicker();
    },
    untick(id) {
      picker?.model.toggle(id);
      changed();
    },
    picker: {
      toggle(id) {
        picker?.model.toggle(id);
        changed();
      },
      toggleGroup(key) {
        picker?.model.toggleGroup(key);
        changed();
      },
      toggleCollapse(key) {
        picker?.model.toggleCollapse(key);
        render();
      },
      setTab(tab) {
        picker?.model.setTab(tab);
        render();
      },
      setFilter(text) {
        picker?.model.setFilter(text);
        render();
      },
      tickAll() {
        picker?.model.tickAll();
        changed();
      },
      add() {
        const ids = [...(picker?.model.ticked() ?? [])];

        picker = null;

        for (const id of ids) {
          modules.open(id);
        }

        changed();
      },
    },
  });

  const inspector = buildInspectorView({
    open() {
      inspectorOpen = true;
      render();
    },
    close() {
      inspectorOpen = false;
      hovered = null;
      render();
    },
    setTab(tab) {
      inspectorTab = tab;
      render();
    },
    toggleFold(key) {
      if (!folds.delete(key)) {
        folds.add(key);
      }

      render();
    },
    openFile(id) {
      if (!modules.isOpen(id)) {
        modules.open(id);
        changed();
      }

      find(id);
    },
    hover(name) {
      hovered = name;
      renderCanvas();
    },
    openCallers(button) {
      openPickerOn(
        button.callers.map((id) => ({ id, names: [button.name] })),
        button.pickerTitle,
      );
    },
  });

  const layout = createLayoutSource(
    startLayoutWorker(),
    layoutOnMainThread,
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

  body.append(tree.element, canvas.element, inspector.element);
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
      ghosts: new Set(),
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

  function graphWith(ghosts: ReadonlySet<string>): CanvasGraph {
    return buildCanvasGraph({
      scans,
      modules: loaded.modules,
      opened: modules.opened(),
      disc: (path) => described.get(path)?.disc ?? "grey",
      folded: state.folded(),
      focus: state.focus(),
      showInferred: state.showInferred(),
      ghosts,
    });
  }

  function staleBarPicker(): boolean {
    const selection = state.selection();

    return (
      picker !== null &&
      picker.kind !== "list" &&
      (selection === null ||
        picker.selection === null ||
        selection.kind !== picker.selection.kind ||
        selection.id !== picker.selection.id)
    );
  }

  function changed() {
    graph = graphWith(picker?.model.ticked() ?? new Set());
    state.reconcile(presenceOf(graph));

    if (staleBarPicker()) {
      picker = null;
      graph = graphWith(new Set());
    }

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

  function dropPicker(): boolean {
    const hadGhosts = (picker?.model.ticked().size ?? 0) > 0;

    picker = null;

    if (hadGhosts) {
      changed();
    }

    return hadGhosts;
  }

  function closePicker() {
    if (!dropPicker()) {
      render();
    }
  }

  function openPicker(next: OpenPicker) {
    picker = next;

    if (next.model.ticked().size > 0) {
      changed();
    } else {
      render();
    }
  }

  function togglePicker(kind: PickerKind) {
    const selection = state.selection();

    if (selection === null || selection.kind === "edge") {
      return;
    }

    if (picker?.kind === kind) {
      closePicker();

      return;
    }

    const counts = graph.counts(selection);

    if (
      (kind === "uses" && counts.uses === 0) ||
      (kind === "usedBy" && counts.usedBy === 0) ||
      (kind === "files" && selection.kind !== "folder")
    ) {
      return;
    }

    const source =
      kind === "files"
        ? ({ kind: "files", id: selection.id } as const)
        : ({
            kind: selection.kind,
            id: selection.id,
            direction: kind,
          } as const);

    dropPicker();
    openPicker({
      model: createPicker({
        scans,
        modules: loaded.modules,
        onCanvas: modules.isOpen,
        source,
      }),
      kind,
      selection,
      anchor: null,
    });
  }

  function openPickerOn(
    items: { id: string; names?: string[] }[],
    title: string,
    anchor?: Point,
  ) {
    openPicker({
      model: createPicker({
        scans,
        modules: loaded.modules,
        onCanvas: modules.isOpen,
        source: { kind: "list", items, title },
      }),
      kind: "list",
      selection: null,
      anchor: anchor ?? null,
    });
  }

  function select(selection: Selection) {
    state.select(selection);
    evidence = null;
    hovered = null;
    reveal(selection);

    if (staleBarPicker()) {
      dropPicker();
    }

    if (selection?.kind === "edge") {
      inspectorOpen = true;
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
    hovered = null;
    reveal({ kind: "module", id });

    if (staleBarPicker()) {
      dropPicker();
    }
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
      picker: picker?.kind === "list" ? null : (picker?.kind ?? null),
      inspectorOpen,
    };
  }

  function renderCanvas() {
    const selection = state.selection();
    const module = selection?.kind === "module" ? selection.id : null;

    canvas.render({
      scene,
      selection,
      highlight:
        hovered !== null && module !== null
          ? emphasisedLines(module, hovered, graph.lines)
          : edgesOf(graph, selection),
      neighbourhood: neighbourhoodOf(graph, selection),
      bar: barOf(selection),
      titles,
      open: modules.count(),
      total: modules.total(),
      treeHidden,
      showInferred: state.showInferred(),
      notice: layoutNotice,
      picker: picker ? { model: picker.model, anchor: picker.anchor } : null,
    });
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
    body.classList.toggle("inspector-open", inspectorOpen);
    renderCanvas();
    inspector.render(
      inspectorContent(selection, {
        scans,
        modules: loaded.modules,
        disc: context.disc,
        findings: health.findings,
        callers,
        onCanvas: modules.isOpen,
        expanded: folds,
        tab: inspectorTab,
        evidence:
          selection?.kind === "edge" && evidence?.id === selection.id
            ? evidence.sections
            : null,
        edgeOnCanvas:
          selection?.kind === "edge" &&
          graph.lines.some((line) => line.id === selection.id),
      }),
      inspectorOpen,
    );

    if (scrollTarget !== null) {
      tree.scrollTo(scrollTarget);
      scrollTarget = null;
    }
  }

  renderNotices();
  changed();

  return { toggleTree, openPickerOn };
}
