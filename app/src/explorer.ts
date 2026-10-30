import {
  folderUsedBy,
  folderUses,
  resolveView,
  usedByOf,
  usesOf,
  type View,
  viewNotes,
} from "recognizer";
import {
  type AgentLineView,
  backLabel,
  createAgentLine,
  forwardLabel,
  realTimer,
} from "./agent-line";
import { type Scheduler, timerScheduler } from "./bar-hover";
import { createBusyGate } from "./busy-gate";
import {
  buildCanvasGraph,
  type CanvasGraph,
  edgesOf,
  neighbourhoodOf,
  presenceOf,
} from "./canvas-graph";
import { absoluteLayout, type Rect, toElk } from "./canvas-layout";
import { type Scene, toScene } from "./canvas-scene";
import { createCanvasState, type Selection } from "./canvas-state";
import {
  buildCanvasView,
  type CanvasNotes,
  createMeasure,
} from "./canvas-view";
import { el } from "./dom";
import {
  describeLine,
  type EvidenceSection,
  evidenceOf,
} from "./edge-evidence";
import { openFolderInEditor, openInEditor } from "./editor-open";
import { type EditorPort, inertEditor } from "./editor-port";
import { compactFolders } from "./folder-compaction";
import { computeHealth, describeTree } from "./health";
import {
  emphasisedLines,
  followableRows,
  type InspectorContent,
  type InspectorTab,
  inspectorContent,
} from "./inspector-model";
import { buildInspectorView, type InspectorActions } from "./inspector-view";
import {
  createLayoutSource,
  layoutOnMainThread,
  startLayoutWorker,
} from "./layout-source";
import { orderNotes, tint, walk } from "./notes-order";
import { buildNotesPanelView } from "./notes-panel-view";
import { createOpenModules } from "./open-modules";
import { mountPanelResizers } from "./panel-resizer-view";
import { buildRailView, type LeftPanel } from "./rail-view";
import { repositorySource } from "./repository-source";
import {
  inertResponsibilities,
  type ResponsibilitiesPort,
} from "./responsibilities-port";
import {
  createDescribing,
  NO_FILES,
  type ResponsibilityState,
  responsibilityStates,
} from "./responsibility-model";
import { nextCheck } from "./row-model";
import type { RowSpec } from "./row-view";
import type { Loaded } from "./scan-loading";
import type { BarModel } from "./selection-bar-view";
import { loadShowPrivate, saveShowPrivate } from "./show-private";
import { buildStalePanel, type StalePanelModel } from "./stale-panel-view";
import {
  currentCommit,
  hasEntries,
  type StaleReport,
  staleReport,
} from "./stale-report";
import {
  bringBack,
  CANVAS_FLOOR,
  close as closeTrail,
  crumbs,
  follow as followInTrail,
  isFollowed,
  MAX_PANELS,
  missingFromCanvas,
  moveFocus,
  panelCapacity,
  RAIL_WIDTH,
  reconcile,
  rowKey,
  startTrail,
  type TrailKeyAction,
  layout as trailLayout,
  trailModules,
  updatePanel,
  withCapacity,
} from "./trail-model";
import { type FilterState, filterTree, isVisible } from "./tree-filter";
import { buildTree } from "./tree-model";
import { buildTreeView } from "./tree-view";
import { buildViewBar } from "./view-bar-view";
import { parseViewFile, serialiseView } from "./view-file";
import { createHistory, type History, type Mark } from "./view-history";
import { resolveLinkedView } from "./view-link";
import { addNote, notedModules, removeNoteAt } from "./view-notes";
import { stepsFor } from "./view-steps";
import { inertViews, type ViewsPort } from "./views-port";
import {
  type DriveAction,
  type DriveFacts,
  type DriveRequest,
  planDrive,
} from "./window-drive";
import { type DriveAnswer, inertWindow, type WindowPort } from "./window-port";
import { latestWins, type Snapshot, windowStateOf } from "./window-state";

export type Carried = {
  history: History<Snapshot>;
  snapshot: Snapshot;
};

export type Explorer = {
  toggleTree: () => void;
  carry: () => Carried;
  openSelectedInEditor: () => void;
  openLinkedView: () => void;
  dispose: () => void;
};

export function showExplorer(
  container: HTMLElement,
  loaded: Loaded,
  title: string,
  onCount: (text: string) => void = () => {},
  views: ViewsPort = inertViews,
  notify: (text: string) => void = () => {},
  carried: Carried | null = null,
  scheduler: Scheduler = timerScheduler,
  storage: Pick<Storage, "getItem" | "setItem"> = {
    getItem: () => null,
    setItem: () => {},
  },
  editor: EditorPort = inertEditor,
  responsibilities: ResponsibilitiesPort = inertResponsibilities,
  windowPort: WindowPort = inertWindow,
  showAgentLine: (line: AgentLineView) => void = () => {},
): Explorer {
  const health = computeHealth(
    loaded.scans,
    loaded.policy,
    loaded.modules,
    loaded.baseline,
  );
  const knownModules = new Set(loaded.modules);
  const compaction = compactFolders(loaded.modules);
  const root = buildTree(loaded.modules, compaction);
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
  let leftPanel: LeftPanel = "files";
  let scrollTarget: string | null = null;
  let graph: CanvasGraph = emptyGraph();
  let scene: Scene | null = null;
  let titles = new Map<string, string>();
  let evidence: { id: string; sections: EvidenceSection[] } | null = null;
  let inspectorOpen = false;
  let inspectorTab: InspectorTab = "contents";
  let hovered: { module: string; name: string } | null = null;
  let trail = startTrail(null, "contents");
  let lastContents: InspectorContent[] = [];
  const folds = new Set<string>();
  let showPrivate = loadShowPrivate(storage);
  let layoutNotice: string | null = null;
  let layoutBusy = false;
  let pickerFilter = "";
  const groupFlips = new Set<string>();
  let openView: string | null = null;
  let viewList: { name: string; text: string }[] = [];
  let viewNotice: string | null = null;
  let listNotice: string | null = null;
  let listKnown = false;
  let listProblem: string | null = null;
  let openToken = 0;
  const viewTexts = new Map<string, string>();
  const reports = new Map<
    string,
    { report: StaleReport; comparing: boolean }
  >();
  const dismissed = new Set<string>();
  const history =
    carried?.history ??
    createHistory<Snapshot>({
      view: null,
      modules: [],
      folded: [],
      focus: null,
      selection: null,
    });
  const agentLine = createAgentLine(showAgentLine, realTimer);
  let batch: { touched: boolean } | null = null;
  const publishWindow = latestWins(windowPort.publish);
  let lastPublished: string | null = null;
  const authorName = views.author().catch(() => "Me");
  let author = "Me";
  let activeNote: number | null = null;
  let canvasNotes: CanvasNotes | undefined;
  let canvasNotesKey = "";

  void authorName.then((name) => {
    author = name;
    render();
  });

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
    putFolderOnCanvas: putAllOn,
    takeFolderOff: takeAllOff,
    find,
    openFolderInEditor: () => void openFolderInEditor(editor, notify),
  });

  const canvas = buildCanvasView(
    {
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
      openContents() {
        inspectorOpen = true;
        inspectorTab = "contents";
        render();
      },
      openInEditor: openSelectedInEditor,
      addNote() {
        if (state.selection()?.kind === "module") {
          openNotes(true);
        }
      },
      removeNote() {
        if (activeNote !== null) {
          removeNote(activeNote);
        }
      },
      walkNotes(delta) {
        const next = walk(noteOrder(), activeNote, delta);

        if (next !== null) {
          orientNote(next);
        }
      },
      measure,
      openTab,
    },
    scheduler,
  );

  const describing = createDescribing();
  let responsibilityOf: (id: string) => ResponsibilityState =
    responsibilityStates(NO_FILES);

  async function readResponsibilities() {
    try {
      responsibilityOf = responsibilityStates(await responsibilities.read());
    } catch (error) {
      const reason = String(error);

      responsibilityOf = () => ({ kind: "unknown", reason });
    }

    describing.read(responsibilityOf);
    render();
  }

  async function describeModule(id: string) {
    if (!describing.start(id)) {
      return;
    }

    render();

    try {
      describing.finish(id, await responsibilities.describe(id));
    } catch (error) {
      describing.finish(id, { status: "failed", reason: String(error) });
    }

    await readResponsibilities();
  }

  const rootActions: InspectorActions = {
    describe: (id) => void describeModule(id),
    open() {
      inspectorOpen = true;
      render();
    },
    close() {
      inspectorOpen = false;
      hovered = null;
      resetList();
      trail = startTrail(state.selection(), inspectorTab);
      render();
    },
    setTab(tab) {
      if (tab !== inspectorTab) {
        resetFilter();
      }

      inspectorTab = tab;
      render();
    },
    setShowPrivate(on) {
      showPrivate = on;
      saveShowPrivate(storage, on);
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
      hoverIn(0, name);
    },
    putOnCanvas: putAllOn,
    takeOff: takeAllOff,
    pickName(id) {
      if (!modules.isOpen(id)) {
        modules.open(id);
        changed();
      }

      canvas.centerOn(boxFor(id));
    },
    toggleGroup(key) {
      if (!groupFlips.delete(key)) {
        groupFlips.add(key);
      }

      render();
    },
    setFilter(text) {
      pickerFilter = text;
      render();
    },
    openInEditor: (target) => void openInEditor(target, editor, notify),
    follow: (relation, id) => followFrom(0, relation, id),
    bringBack(index) {
      trail = bringBack(trail, index);
      render();
    },
    putTrailOnCanvas,
    trailKey,
  };

  function toggled(set: ReadonlySet<string>, key: string): Set<string> {
    const next = new Set(set);

    if (!next.delete(key)) {
      next.add(key);
    }

    return next;
  }

  function actionsFor(index: number): InspectorActions {
    if (index === 0) {
      return rootActions;
    }

    const panel = () => trail.panels[index];

    return {
      ...rootActions,
      close() {
        trail = closeTrail(trail, index);
        hovered = null;
        render();
      },
      setTab(tab) {
        const reset =
          tab !== panel().tab
            ? { filter: "", groupFlips: new Set<string>() }
            : {};

        trail = updatePanel(trail, index, { tab, ...reset });
        render();
      },
      toggleFold(key) {
        trail = updatePanel(trail, index, {
          folds: toggled(panel().folds, key),
        });
        render();
      },
      toggleGroup(key) {
        trail = updatePanel(trail, index, {
          groupFlips: toggled(panel().groupFlips, key),
        });
        render();
      },
      setFilter(text) {
        trail = updatePanel(trail, index, { filter: text });
        render();
      },
      hover: (name) => hoverIn(index, name),
      follow: (relation, id) => followFrom(index, relation, id),
    };
  }

  const inspector = buildInspectorView(rootActions, actionsFor);

  const layoutGate = createBusyGate(
    () => {
      layoutBusy = true;
      render();
    },
    () => {
      layoutBusy = false;
      render();
    },
  );
  let endLayoutBusy: (() => void) | null = null;

  function endLayout() {
    endLayoutBusy?.();
    endLayoutBusy = null;
  }

  const layout = createLayoutSource(
    startLayoutWorker(),
    layoutOnMainThread,
    (result) => {
      endLayout();
      layoutNotice = null;
      scene = toScene(graph, absoluteLayout(result));
      render();
    },
    (message) => {
      endLayout();
      layoutNotice = `Layout failed: ${message}`;
      render();
    },
  );

  const bar = buildViewBar({
    back: () => step(history.back()),
    forward: () => step(history.forward()),
    openView: (name) => void openSaved(name),
    save: () => void saveOpen(),
    saveNew: (name, description) => saveNew(name, description),
    rename: (from, to) => renameOpen(from, to),
    copyLink: () => void copyLink(),
    hasOpenView: () => openView !== null,
  });
  const stale = buildStalePanel({
    update: () => void update(),
    leave() {
      if (openView !== null) {
        dismissed.add(openView);
        render();
      }
    },
  });
  const notesPanel = buildNotesPanelView({
    select: (index) => orientNote(index),
    remove: (index) => removeNote(index),
    add(module, text) {
      void writeNote(async (view) => addNote(view, module, text, author)).then(
        () => {
          const view = openViewValue();

          activeNote = view === null ? null : viewNotes(view).length - 1;

          if (activeNote === null) {
            render();
          } else {
            orientNote(activeNote);
          }
        },
      );
    },
  });
  const rail = buildRailView({
    toggleFiles: toggleTree,
    toggleNotes: () => openNotes(false),
  });
  const notices = el("div", "notices");

  notices.setAttribute("role", "status");

  const body = el("div", "explorer");

  const widths = mountPanelResizers(
    body,
    { tree: tree.element, inspector: inspector.element },
    storage,
    {
      shownPanels: () =>
        inspectorOpen ? Math.max(1, trailLayout(trail).shown.length) : 1,
      committed: () => render(),
    },
  );

  canvas.element.append(bar.element, stale.element);
  tree.element.append(notesPanel.element);
  body.append(rail.element, tree.element, canvas.element, inspector.element);
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
      ...[
        ...loaded.notices,
        ...health.notices,
        ...(listNotice === null ? [] : [listNotice]),
        ...(viewNotice === null ? [] : [viewNotice]),
      ].map((text) => el("p", "notice-line", text)),
    );
    notices.hidden = notices.childElementCount === 0;
  }

  function hoverIn(index: number, name: string | null) {
    const selection = trail.panels[index]?.selection ?? null;

    hovered =
      name !== null && selection?.kind === "module"
        ? { module: selection.id, name }
        : null;
    renderCanvas();
  }

  function followFrom(index: number, relation: "uses" | "usedBy", id: string) {
    trail = updatePanel(trail, index, {
      focusedRow: rowKey({ id, relation }),
    });
    trail = followInTrail(trail, index, relation, id);
    hovered = null;
    render();
  }

  function putTrailOnCanvas() {
    const missing = missingFromCanvas(trail, modules.isOpen);

    if (missing.length > 0) {
      putAllOn(missing);
    }
  }

  function trailKey(action: TrailKeyAction): boolean {
    const index = trail.active;
    const panel = trail.panels[index];
    const rows = lastContents[index]?.rows ?? [];
    const listed = followableRows(rows);
    const keys = listed.map(rowKey);
    const focused = listed.find((row) => rowKey(row) === panel.focusedRow);

    if (action === "up" || action === "down") {
      if (keys.length === 0) {
        return false;
      }

      trail = updatePanel(trail, index, {
        focusedRow: moveFocus(keys, panel.focusedRow, action),
      });
      render();

      return true;
    }

    if (action === "follow") {
      if (focused === undefined) {
        return false;
      }

      if (isFollowed(trail, index, focused.relation, focused.id)) {
        trail = bringBack(trail, index + 1);
        render();
      } else {
        followFrom(index, focused.relation, focused.id);
      }

      return true;
    }

    if (action === "back") {
      if (index === 0) {
        return false;
      }

      const previous = trail.panels[index - 1];

      trail = updatePanel(bringBack(trail, index - 1), index - 1, {
        focusedRow: previous.followed ? rowKey(previous.followed) : null,
      });
      render();

      return true;
    }

    if (action === "tick") {
      const row = rows.find(
        (candidate) =>
          candidate.kind === "module" &&
          candidate.follow !== null &&
          focused !== undefined &&
          candidate.id === focused.id &&
          candidate.follow === focused.relation,
      );

      if (row === undefined || row.kind !== "module") {
        return false;
      }

      if (nextCheck(row.state) === "takeOff") {
        takeAllOff(row.ids);
      } else {
        putAllOn(row.ids);
      }

      return true;
    }

    if (action === "close-last") {
      if (trail.panels.length < 2) {
        return false;
      }

      trail = closeTrail(trail, trail.panels.length - 1);
      hovered = null;
      render();

      return true;
    }

    putTrailOnCanvas();

    return true;
  }

  function trailCapacity(): number {
    const width = body.clientWidth;

    if (width === 0) {
      return MAX_PANELS;
    }

    const tree = leftPanel === null ? 0 : widths.tree;
    const available = width - RAIL_WIDTH - tree - CANVAS_FLOOR;

    return panelCapacity(available, widths.inspector, trail.panels.length);
  }

  function syncTrail(selection: Selection) {
    const first = trail.panels[0].selection;

    if (first?.kind !== selection?.kind || first?.id !== selection?.id) {
      trail = startTrail(selection, inspectorTab);
    }

    trail = reconcile(trail, knownModules);
    trail = withCapacity(trail, trailCapacity());
  }

  function putAllOn(ids: string[]) {
    for (const id of ids) {
      modules.open(id);
    }

    changed();
  }

  function takeAllOff(ids: string[]) {
    for (const id of ids) {
      modules.close(id);
    }

    changed();
  }

  function resetFilter() {
    pickerFilter = "";
    groupFlips.clear();
  }

  function resetList() {
    resetFilter();
  }

  function openTab(tab: InspectorTab) {
    if (tab === "dependencies") {
      const selection = state.selection();

      if (selection === null || selection.kind === "edge") {
        return;
      }

      const counts = graph.counts(selection);

      if (counts.uses + counts.usedBy === 0) {
        return;
      }
    }

    if (tab !== inspectorTab) {
      resetFilter();
    }

    inspectorOpen = true;
    inspectorTab = tab;
    render();
  }

  function changed() {
    rebuild();
    record();
  }

  function rebuild() {
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
    endLayoutBusy ??= layoutGate.begin();
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
      for (const folder of compaction.ancestors(selection.id)) {
        expanded.add(folder);
      }

      scrollTarget = selection.id;
    }
  }

  function select(selection: Selection) {
    const previous = state.selection();

    activeNote = null;

    if (previous?.kind !== selection?.kind || previous?.id !== selection?.id) {
      resetList();
    }

    state.select(selection);
    trail = startTrail(selection, inspectorTab);
    evidence = null;
    hovered = null;
    reveal(selection);

    if (selection?.kind === "edge") {
      inspectorOpen = true;
      void loadEvidence(selection.id);
    }

    render();
    record();
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
    activeNote = null;

    if (!modules.isOpen(id)) {
      modules.open(id);
      rebuild();
    }

    const previous = state.selection();

    if (previous?.kind !== "module" || previous.id !== id) {
      resetList();
    }

    state.select({ kind: "module", id });
    evidence = null;
    hovered = null;
    reveal({ kind: "module", id });
    render();
    canvas.centerOn(boxFor(id));
    record();
  }

  function toggleTree() {
    leftPanel = leftPanel === "files" ? null : "files";
    render();
  }

  function openNotes(focus: boolean) {
    const wasOpen = leftPanel === "notes";

    leftPanel = wasOpen && !focus ? null : "notes";
    render();

    if (leftPanel === "notes" && (focus || !wasOpen)) {
      notesPanel.focusComposer();
    }
  }

  function noteBoxes(): Map<string, Rect> {
    return new Map(
      (scene?.boxes ?? [])
        .filter((box) => box.kind === "module")
        .map((box) => [box.id, box.rect]),
    );
  }

  function noteOrder() {
    const view = openViewValue();

    return orderNotes(view === null ? [] : viewNotes(view), noteBoxes());
  }

  function orientNote(index: number) {
    const view = openViewValue();
    const note = view === null ? undefined : viewNotes(view)[index];

    if (note === undefined || !noteBoxes().has(note.module)) {
      return;
    }

    select({ kind: "module", id: note.module });
    activeNote = index;
    canvas.centerOn(boxFor(note.module));
    render();
  }

  function removeNote(index: number) {
    if (activeNote === index) {
      activeNote = null;
    } else if (activeNote !== null && activeNote > index) {
      activeNote -= 1;
    }

    void writeNote(async (view) => removeNoteAt(view, index));
  }

  function barOf(selection: Selection): BarModel | null {
    if (selection === null || selection.kind === "edge") {
      return null;
    }

    const counts = graph.counts(selection);

    return {
      kind: selection.kind,
      dependencies: counts.uses + counts.usedBy,
      files:
        selection.kind === "folder"
          ? { open: graph.openIn(selection.id), held: graph.held(selection.id) }
          : null,
      focused: state.focus() === selection.id,
      folded: state.folded().has(selection.id),
      inspectorTab: inspectorOpen ? inspectorTab : null,
    };
  }

  function snapshot(): Snapshot {
    const selection = state.selection();

    return {
      view: openView,
      modules: modules.opened().sort((a, b) => a.localeCompare(b)),
      folded: [...state.folded()].sort((a, b) => a.localeCompare(b)),
      focus: state.focus(),
      selection: selection === null ? null : { ...selection },
    };
  }

  function publish() {
    const text = `${JSON.stringify(
      windowStateOf(snapshot(), trail, {
        open: inspectorOpen,
        tab: inspectorTab,
      }),
      null,
      2,
    )}\n`;

    if (text === lastPublished) {
      return;
    }

    lastPublished = text;
    publishWindow(text);
  }

  function record(mark?: Mark): boolean {
    if (batch !== null && mark === undefined) {
      batch.touched = true;
      publish();
      renderBar();

      return false;
    }

    const recorded = history.record(snapshot(), mark);

    if (mark === undefined) {
      agentLine.clear();
    }

    publish();
    renderBar();

    return recorded;
  }

  function canvasContent() {
    return {
      modules: modules.opened(),
      folded: [...state.folded()],
      focus: state.focus(),
    };
  }

  function restoreCanvas(folded: string[], focus: string | null) {
    state.restore(
      [...new Set(folded.map(compaction.canonical))],
      focus === null ? null : compaction.canonical(focus),
    );
  }

  function canonicalSelection(selection: Selection): Selection {
    return selection?.kind === "folder"
      ? { kind: "folder", id: compaction.canonical(selection.id) }
      : selection;
  }

  function setCanvas(ids: string[], folded: string[], focus: string | null) {
    for (const id of modules.opened()) {
      modules.close(id);
    }

    for (const id of ids) {
      modules.open(id);
    }

    restoreCanvas(folded, focus);
    state.clearSelection();
    evidence = null;
    hovered = null;
    resetList();
    rebuild();
    record();
  }

  function step(snap: Snapshot | null) {
    if (snap === null) {
      return;
    }

    agentLine.clear();

    for (const id of modules.opened()) {
      modules.close(id);
    }

    for (const id of snap.modules) {
      modules.open(id);
    }

    restoreCanvas(snap.folded, snap.focus);
    openView = snap.view;
    evidence = null;
    hovered = null;
    resetList();
    rebuild();
    state.select(canonicalSelection(snap.selection));
    state.reconcile(presenceOf(graph));
    reveal(state.selection());
    render();
    renderBar();
  }

  function trailNeighbours(): DriveFacts["trail"] {
    const selection = trail.panels[trail.active]?.selection ?? null;

    if (selection === null || selection.kind === "edge") {
      return null;
    }

    const rows = (uses: boolean) =>
      (selection.kind === "module"
        ? uses
          ? usesOf(scans, loaded.modules, selection.id)
          : usedByOf(scans, loaded.modules, selection.id)
        : uses
          ? folderUses(scans, loaded.modules, selection.id)
          : folderUsedBy(scans, loaded.modules, selection.id)
      ).map((row) => row.id);

    return { selection, uses: rows(true), usedBy: rows(false) };
  }

  function driveFacts(): DriveFacts {
    return {
      modules: knownModules,
      onCanvas: new Set(modules.opened()),
      folded: state.folded(),
      focus: state.focus(),
      selection: state.selection(),
      canonical: compaction.canonical,
      views: viewList.map((view) => view.name),
      trail: trailNeighbours(),
    };
  }

  async function perform(action: DriveAction): Promise<string | null> {
    switch (action.kind) {
      case "open":
        for (const id of action.ids) {
          modules.open(id);
        }

        changed();

        return null;
      case "close":
        for (const id of action.ids) {
          modules.close(id);
        }

        changed();

        return null;
      case "fold":
        for (const folder of action.folders) {
          if (state.folded().has(folder) === action.off) {
            state.toggleFold(folder);
          }
        }

        changed();

        return null;
      case "focus":
        state.toggleFocus(action.folder);
        changed();

        return null;
      case "select":
        select(action.selection);

        return null;
      case "follow":
        followFrom(trail.active, action.relation, action.id);
        inspectorOpen = true;
        inspectorTab = "dependencies";
        render();

        return null;
      case "open-view": {
        viewNotice = null;
        await openSaved(action.name);

        return viewNotice === null && openView === action.name
          ? null
          : (viewNotice ?? `could not open view ${action.name}`);
      }
      case "clear":
        if (action.target === "all") {
          state.clear();
        } else if (action.target === "modules") {
          for (const id of modules.opened()) {
            modules.close(id);
          }
        } else if (action.target === "folds") {
          state.restore([], state.focus());
        } else if (action.target === "focus") {
          state.restore([...state.folded()], null);
        } else {
          state.clearSelection();
        }

        evidence = null;
        hovered = null;
        changed();

        return null;
    }
  }

  async function drive(request: DriveRequest): Promise<DriveAnswer> {
    const plan = planDrive(request, driveFacts());

    if ("refuse" in plan) {
      return { status: "refused", reason: plan.refuse };
    }

    const mark: Mark = { by: request.by, summary: plan.summary };
    const followed = plan.apply.some((action) => action.kind === "follow");

    batch = { touched: false };

    try {
      for (const action of plan.apply) {
        const problem = await perform(action);

        if (problem !== null) {
          return { status: "refused", reason: problem };
        }
      }
    } finally {
      batch = null;
    }

    const recorded = record(mark);

    if (recorded) {
      agentLine.show(mark, () => step(history.back()));
    }

    const changedNow = recorded || followed;

    return {
      status: "done",
      summary: changedNow ? plan.summary : "nothing changed",
      changed: changedNow,
    };
  }

  function setViewList(list: { name: string; text: string }[]) {
    viewList = list;
    renderBar();
  }

  async function loadViewList() {
    try {
      const listing = await views.list();

      listNotice =
        listing.refused.length === 0
          ? null
          : `Could not read saved views: ${listing.refused.join("; ")}`;
      listKnown = true;
      listProblem = null;
      setViewList(listing.views);
    } catch (error) {
      listNotice = `Could not list saved views: ${String(error)}`;
      listProblem = String(error);
      listKnown = false;
      renderBar();
    }

    renderNotices();
  }

  function openViewValue(): View | null {
    if (openView === null) {
      return null;
    }

    const text =
      viewTexts.get(openView) ??
      viewList.find((entry) => entry.name === openView)?.text;
    const parsed = text === undefined ? null : parseViewFile(text);

    return parsed?.ok ? parsed.view : null;
  }

  async function writeNote(change: (view: View) => Promise<View>) {
    const name = openView;
    const view = openViewValue();

    if (name === null || view === null) {
      return;
    }

    await writeView(name, await change(view));
    renderBar();
    render();
  }

  function renderBar() {
    bar.render({
      open: openView,
      views: viewList.map(({ name, text }) => {
        const parsed = parseViewFile(text);

        return {
          name,
          description: parsed.ok ? parsed.view.description : null,
        };
      }),
      canBack: history.canBack(),
      listed: listKnown,
      listProblem,
      canForward: history.canForward(),
      backLabel: backLabel(history.markNow()),
      forwardLabel: forwardLabel(history.markNext()),
      canCopy: openView !== null,
    });
  }

  function rowFor(id: string): RowSpec {
    const on = modules.isOpen(id);

    return {
      label: id,
      state: on ? "checked" : "unchecked",
      bold: on,
      disc: context.disc(id),
      discHover: described.get(id)?.hover,
      onCheck: () => (on ? takeAllOff([id]) : putAllOn([id])),
      onName: () => find(id),
    };
  }

  function stalePanelModel(): StalePanelModel | null {
    const entry = openView === null ? undefined : reports.get(openView);

    if (
      openView === null ||
      entry === undefined ||
      dismissed.has(openView) ||
      (!entry.comparing && !hasEntries(entry.report))
    ) {
      return null;
    }

    const { report } = entry;

    return {
      missing: report.missing.map((missing) => ({
        path: missing.path,
        rename: missing.renamedTo === null ? null : rowFor(missing.renamedTo),
      })),
      removed: (report.changed?.removed ?? []).map(describeEdge),
      added: (report.changed?.added ?? []).map(describeEdge),
      newlyRelevant: (report.newlyRelevant ?? []).map(rowFor),
      comparing: entry.comparing,
      unavailable: report.unavailable,
    };
  }

  function describeEdge(edge: { from: string; to: string }): string {
    return `${edge.from} -> ${edge.to}`;
  }

  async function applyView(name: string, text: string, withRenames: boolean) {
    const parsed = parseViewFile(text);

    if (!parsed.ok) {
      viewNotice = `${name} is not a valid view: ${parsed.reason}`;
      renderNotices();

      return;
    }

    const { view } = parsed;
    const token = ++openToken;
    const resolved = resolveView(view, scans);
    const missingPicks = resolved.unresolved.filter(
      (entry) => entry.kind === "pick",
    );
    const renames =
      withRenames && view.commit !== null && missingPicks.length > 0
        ? await views.renamesSince(view.commit).catch(() => [])
        : [];

    if (token !== openToken) {
      return;
    }

    const known = new Set(loaded.modules);
    const renamed = missingPicks.flatMap((entry) => {
      const target = renames.find(
        (rename) => rename.from === entry.path && known.has(rename.to),
      );

      return target === undefined ? [] : [target.to];
    });

    viewNotice = null;
    renderNotices();
    viewTexts.set(name, text);
    dismissed.delete(name);
    openView = name;
    setCanvas(
      [...resolved.modules, ...renamed],
      resolved.folded,
      resolved.focus,
    );
    await compare(name, view, renames, token);
  }

  async function recompare(name: string) {
    const text = viewList.find((view) => view.name === name)?.text;
    const parsed = text === undefined ? null : parseViewFile(text);

    if (
      text === undefined ||
      parsed === null ||
      !parsed.ok ||
      openView !== name
    ) {
      return;
    }

    const token = ++openToken;
    const missingPicks = resolveView(parsed.view, scans).unresolved.filter(
      (entry) => entry.kind === "pick",
    );
    const renames =
      parsed.view.commit !== null && missingPicks.length > 0
        ? await views.renamesSince(parsed.view.commit).catch(() => [])
        : [];

    if (token !== openToken) {
      return;
    }

    viewTexts.set(name, text);
    await compare(name, parsed.view, renames, token);
  }

  async function compare(
    name: string,
    view: Parameters<typeof staleReport>[0]["view"],
    renames: { from: string; to: string }[],
    token: number,
  ) {
    const needsScan =
      view.commit !== null && view.commit !== currentCommit(scans);

    if (!needsScan) {
      reports.set(name, {
        report: staleReport({ view, now: scans, before: null, renames }),
        comparing: false,
      });
      render();

      return;
    }

    reports.set(name, {
      report: staleReport({ view, now: scans, before: null, renames }),
      comparing: true,
    });
    render();

    const before = await views.scansAt(view.commit as string).catch(() => null);

    if (token !== openToken) {
      return;
    }

    reports.set(name, {
      report: staleReport({ view, now: scans, before, renames }),
      comparing: false,
    });
    render();
  }

  async function openSaved(name: string) {
    const text = viewList.find((view) => view.name === name)?.text;

    if (text !== undefined) {
      await applyView(name, text, true);
    }
  }

  async function writeView(
    name: string,
    view: Parameters<typeof serialiseView>[0],
  ): Promise<string | null> {
    const fail = (problem: string) => {
      viewNotice = problem;
      renderNotices();

      return problem;
    };

    try {
      const text = serialiseView(view);
      const checked = parseViewFile(text);

      if (!checked.ok) {
        return fail(`${name} is not a valid view: ${checked.reason}`);
      }

      viewTexts.set(name, text);
      await views.write(name, text);
      setViewList(
        [
          ...viewList.filter((entry) => entry.name !== name),
          { name, text },
        ].sort((a, b) => a.name.localeCompare(b.name)),
      );

      return null;
    } catch (error) {
      return fail(`Could not save ${name}: ${String(error)}`);
    }
  }

  async function saveOpen() {
    const name = openView;
    const text = name === null ? undefined : viewTexts.get(name);
    const parsed = text === undefined ? null : parseViewFile(text);

    if (name === null || parsed === null || !parsed.ok) {
      return;
    }

    const entry = reports.get(name);
    const clean =
      entry === undefined || (!entry.comparing && !hasEntries(entry.report));

    if (
      (await writeView(name, {
        ...parsed.view,
        commit: clean ? currentCommit(scans) : parsed.view.commit,
        steps: stepsFor(parsed.view.steps, canvasContent(), scans),
      })) === null
    ) {
      notify(`Saved ${name}`);
    }
  }

  async function saveNew(name: string, description: string) {
    const problem = await writeView(name, {
      schema_version: 3,
      description,
      commit: currentCommit(scans),
      steps: stepsFor([], canvasContent(), scans),
    });

    if (problem === null) {
      reports.delete(name);
      openView = name;
      record();
      notify(`Saved ${name}`);
    }

    return problem;
  }

  async function renameOpen(from: string, to: string) {
    try {
      await views.rename(from, to);
    } catch (error) {
      return String(error);
    }

    const text = viewTexts.get(from);
    const report = reports.get(from);

    viewTexts.delete(from);
    reports.delete(from);

    if (text !== undefined) {
      viewTexts.set(to, text);
    }

    if (report !== undefined) {
      reports.set(to, report);
    }

    if (dismissed.delete(from)) {
      dismissed.add(to);
    }

    if (openView === from) {
      openView = to;
    }

    history.remap((snap) =>
      snap.view === from ? { ...snap, view: to } : snap,
    );
    setViewList(
      viewList
        .map((view) => (view.name === from ? { ...view, name: to } : view))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
    render();
    notify(`Renamed ${from} to ${to}`);

    return null;
  }

  async function copyLink() {
    if (openView === null) {
      return;
    }

    const link = await views.link(openView);

    await views.copy(link);
    notify(`Copied ${link}`);
  }

  async function openLinkedView() {
    const pending = await views.takePendingView();

    if (pending === null) {
      return;
    }

    await loadViewList();

    const resolved = resolveLinkedView(
      viewList.map((view) => view.name),
      pending,
    );

    if ("open" in resolved) {
      await openSaved(resolved.open);
    } else {
      notify(resolved.refuse);
    }
  }

  async function update() {
    const name = openView;
    const text = name === null ? undefined : viewTexts.get(name);
    const parsed = text === undefined ? null : parseViewFile(text);
    const entry = name === null ? undefined : reports.get(name);

    if (name === null || parsed === null || !parsed.ok || entry === undefined) {
      return;
    }

    const { view } = parsed;
    const { report } = entry;
    const dropped = new Set(report.missing.map((missing) => missing.step));
    const replaced = new Map(
      report.missing.flatMap((missing) =>
        missing.kind === "pick" &&
        missing.renamedTo !== null &&
        modules.isOpen(missing.renamedTo)
          ? [[missing.step, missing.renamedTo] as const]
          : [],
      ),
    );
    const picked = new Set(
      view.steps.flatMap((item) => (item.kind === "pick" ? [item.module] : [])),
    );
    const steps: typeof view.steps = [];

    view.steps.forEach((item, index) => {
      const target = replaced.get(index + 1);

      if (target !== undefined) {
        if (!picked.has(target)) {
          picked.add(target);
          steps.push({ kind: "pick", module: target });
        }
      } else if (!dropped.has(index + 1)) {
        steps.push(item);
      }
    });

    for (const id of report.newlyRelevant ?? []) {
      if (modules.isOpen(id) && !picked.has(id)) {
        picked.add(id);
        steps.push({ kind: "pick", module: id });
      }
    }

    const next = { ...view, commit: currentCommit(scans), steps };

    if ((await writeView(name, next)) !== null) {
      return;
    }

    reports.delete(name);
    dismissed.delete(name);
    openToken += 1;

    const resolved = resolveView(next, scans);

    setCanvas(resolved.modules, resolved.folded, resolved.focus);
  }

  async function onViewsChanged() {
    await loadViewList();

    if (openView === null) {
      return;
    }

    const name = openView;
    const entry = viewList.find((view) => view.name === name);

    if (entry === undefined) {
      openView = null;
      viewTexts.delete(name);
      reports.delete(name);
      openToken += 1;
      viewNotice = `${name} was deleted from .recognizer/views`;
      renderNotices();
      record();
      render();

      return;
    }

    if (entry.text === viewTexts.get(name)) {
      return;
    }

    reports.delete(name);
    await applyView(name, entry.text, true);
  }

  function syncNotes(): CanvasNotes {
    const view = openViewValue();
    const notes = view === null ? [] : viewNotes(view);
    const boxes = noteBoxes();
    const active = activeNote === null ? undefined : notes[activeNote];

    if (
      activeNote !== null &&
      (active === undefined || !boxes.has(active.module))
    ) {
      activeNote = null;
    }

    const shown = activeNote === null ? undefined : notes[activeNote];
    const marks = view === null ? new Set<string>() : notedModules(view);
    const keys = {
      notesOpen: leftPanel === "notes",
      noteActive: activeNote !== null,
    };
    const key = JSON.stringify([
      [...marks].sort(),
      shown?.module ?? null,
      shown?.text ?? null,
      shown === undefined ? null : tint(shown.by, author),
      keys,
    ]);

    if (key !== canvasNotesKey || canvasNotes === undefined) {
      canvasNotesKey = key;
      canvasNotes = {
        marks,
        active: shown?.module ?? null,
        card:
          shown === undefined
            ? null
            : {
                module: shown.module,
                text: shown.text,
                tint: tint(shown.by, author),
              },
        keys,
      };
    }

    return canvasNotes;
  }

  function renderCanvas() {
    const notes = syncNotes();

    onCount(`${modules.count()} of ${modules.total()} modules on the canvas`);

    const selection = state.selection();
    const outlined =
      inspectorOpen && trail.panels.length > 1
        ? new Set(trailModules(trail))
        : null;
    const near = neighbourhoodOf(graph, selection);

    if (near !== null && outlined !== null) {
      for (const id of outlined) {
        near.add(id);
      }
    }

    canvas.render({
      scene,
      selection,
      highlight:
        hovered !== null
          ? emphasisedLines(hovered.module, hovered.name, graph.lines)
          : edgesOf(graph, selection),
      neighbourhood: near,
      trail: outlined,
      bar: barOf(selection),
      titles,
      open: modules.count(),
      total: modules.total(),
      showInferred: state.showInferred(),
      notice: layoutNotice,
      busy: layoutBusy,
      notes,
    });
  }

  function render() {
    const filtered = filterTree(root, filter, context);
    const selection = state.selection();

    syncTrail(selection);
    body.classList.toggle("tree-hidden", leftPanel === null);
    tree.element.classList.toggle("notes-open", leftPanel === "notes");

    const noteView = openViewValue();
    const noteTotal = noteView === null ? 0 : viewNotes(noteView).length;

    rail.render({ panel: leftPanel, notes: noteTotal });
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
    stale.render(stalePanelModel());
    renderCanvas();
    notesPanel.render({
      hasView: noteView !== null,
      order: noteOrder(),
      active: activeNote,
      author,
      target: selection?.kind === "module" ? selection.id : null,
      targetIsModule: selection?.kind === "module",
    });
    const contentOf = (index: number) => {
      const panel = trail.panels[index];
      const root = index === 0;

      return inspectorContent(panel.selection, {
        scans,
        modules: loaded.modules,
        compaction,
        disc: context.disc,
        findings: health.findings,
        onCanvas: modules.isOpen,
        expanded: root ? folds : panel.folds,
        showPrivate,
        tab: root ? inspectorTab : panel.tab,
        evidence:
          root && selection?.kind === "edge" && evidence?.id === selection.id
            ? evidence.sections
            : null,
        edgeOnCanvas:
          root &&
          selection?.kind === "edge" &&
          graph.lines.some((line) => line.id === selection.id),
        counts: graph.counts,
        filter: root ? pickerFilter : panel.filter,
        collapsed: root ? groupFlips : panel.groupFlips,
        followed: panel.followed,
        responsibility: (id) => ({
          state: responsibilityOf(id),
          busy: describing.busy(id),
          failure: describing.failure(id),
        }),
      });
    };

    lastContents = trail.panels.map((_, index) => contentOf(index));

    const placed = trailLayout(trail);
    const multi = inspectorOpen && trail.panels.length > 1;

    body.style.setProperty(
      "--inspector-shown",
      String(multi ? placed.shown.length : 1),
    );
    body.style.setProperty(
      "--inspector-strips",
      String(multi ? placed.strips.length + placed.later.length : 0),
    );
    inspector.render(lastContents[0], inspectorOpen, {
      contents: lastContents,
      layout: placed,
      active: trail.active,
      crumbs: crumbs(trail, compaction),
      focused: trail.panels.map((panel) => panel.focusedRow),
      canPut: missingFromCanvas(trail, modules.isOpen).length > 0,
    });

    if (scrollTarget !== null) {
      tree.scrollTo(scrollTarget);
      scrollTarget = null;
    }

    publish();
  }

  function resume(snap: Snapshot) {
    const known = new Set(loaded.modules);
    const isFolder = (id: string) =>
      loaded.modules.some((module) => module.startsWith(`${id}/`));
    const selection = snap.selection;
    const gone = snap.modules.filter((id) => !known.has(id)).length;

    for (const id of snap.modules) {
      modules.open(id);
    }

    restoreCanvas(
      snap.folded.filter(isFolder),
      snap.focus !== null && isFolder(snap.focus) ? snap.focus : null,
    );
    openView = snap.view;
    rebuild();

    if (
      selection !== null &&
      (selection.kind === "edge" ||
        (selection.kind === "module"
          ? known.has(selection.id)
          : isFolder(selection.id)))
    ) {
      state.select(canonicalSelection(selection));
    }

    state.reconcile(presenceOf(graph));
    reveal(state.selection());
    render();
    record();

    if (gone > 0) {
      notify(
        `Rescanned: ${gone} ${gone === 1 ? "module" : "modules"} on the canvas ${gone === 1 ? "is" : "are"} gone`,
      );
    }
  }

  renderNotices();

  if (carried === null) {
    changed();
  } else {
    resume(carried.snapshot);
  }

  const resizeObserver =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          if (inspectorOpen && trailCapacity() !== trail.cap) {
            render();
          }
        });

  resizeObserver?.observe(body);

  const stopDriving = windowPort.onDrive(drive);
  const stopWatching = views.onChanged(() => void onViewsChanged());
  const stopWatchingResponsibilities = responsibilities.onChanged(
    () => void readResponsibilities(),
  );

  void readResponsibilities();

  void loadViewList().then(() => {
    if (carried?.snapshot.view != null) {
      void recompare(carried.snapshot.view);
    }
  });

  function openSelectedInEditor() {
    void openInEditor(state.selection(), editor, notify);
  }

  return {
    toggleTree,
    openSelectedInEditor,
    openLinkedView: () => void openLinkedView(),
    carry: () => ({ history, snapshot: snapshot() }),
    dispose() {
      resizeObserver?.disconnect();
      stopWatching();
      stopDriving();
      agentLine.clear();
      stopWatchingResponsibilities();
      bar.dispose();
    },
  };
}
