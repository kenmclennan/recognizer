import {
  type ChangeFacts,
  changeMarks,
  type FileChange,
  type FindingRecord,
  folderUsedBy,
  folderUses,
  isOrdered,
  type MarkedModule,
  type MarkScan,
  rangeText,
  resolveView,
  type Scan,
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
import { boxTooltip, type TooltipLine } from "./box-tooltip";
import { createBusyGate } from "./busy-gate";
import {
  buildCanvasGraph,
  type CanvasGraph,
  edgesOf,
  neighbourhoodOf,
  presenceOf,
} from "./canvas-graph";
import { isEditable } from "./canvas-keys";
import { absoluteLayout, type Rect, toElk } from "./canvas-layout";
import { type Scene, toScene } from "./canvas-scene";
import { createCanvasState, type Selection } from "./canvas-state";
import {
  buildCanvasView,
  type CanvasNotes,
  type CanvasOrientation,
  type ChangeOverlay,
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
import { type Ghost, ghostPlacement, keepsFocus } from "./finding-focus";
import { litSet } from "./findings-card";
import {
  applyFilter,
  badge,
  chips,
  type FindingFilter,
  type FindingRow,
  findingRows,
  groupFindings,
  sameFilter,
  staleNote,
  walkFindings,
} from "./findings-order";
import { buildFindingsPanelView } from "./findings-panel-view";
import { compactFolders } from "./folder-compaction";
import { ageText, type ScanState } from "./footer-scan";
import { computeHealth, describeTree } from "./health";
import {
  emphasisedLines,
  findingsTone,
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
import type { CanvasMetrics } from "./metrics-view";
import {
  bubbleSet,
  keepsFocus as keepsNoteFocus,
  type NoteFocus,
  type NoteRow,
  notePathOf,
  noteRows,
  walkNotes,
} from "./note-focus";
import { buildNotesPanelView } from "./notes-panel-view";
import { createOpenModules } from "./open-modules";
import {
  buildOverlayModel,
  currentMetricNamed,
  footerText,
  type MetricDescriptor,
  moduleValue,
  pruneTicks,
} from "./overlay-model";
import { mountPanelResizers } from "./panel-resizer-view";
import { buildRailView, type LeftPanel } from "./rail-view";
import { removedPlacement } from "./removed-boxes";
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
import {
  NO_RUN,
  type RunState,
  registeredNames,
  type ScanTicks,
  scanPanel,
} from "./scan-panel-model";
import { buildScanPanelView } from "./scan-panel-view";
import type { ShowTarget } from "./scan-progress";
import type { BarModel } from "./selection-bar-view";
import {
  inertSensors,
  type SensorsPort,
  type ShippedSensors,
  scansCommit,
} from "./sensor-run";
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
  type PanelFit,
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
import {
  createHistory,
  type History,
  type Mark,
  type OrderState,
} from "./view-history";
import { resolveLinkedView } from "./view-link";
import {
  noteAt,
  notedPaths,
  orderOf,
  setNote,
  withNoteMoved,
  withOrder,
  removeNote as withoutNote,
} from "./view-notes";
import { stepsFor } from "./view-steps";
import { chipOf, dropdownNames, viewsPanelModel } from "./views-panel-model";
import { buildViewsPanelView } from "./views-panel-view";
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
  leftPanel: LeftPanel;
  metricTicks?: string[];
};

export type ScanHost = {
  port: SensorsPort;
  scan: () => ScanState | null;
  ticks: () => ScanTicks;
  setTicks: (next: ScanTicks) => void;
  runState: () => RunState;
  running: () => boolean;
  run: () => void;
  stop: () => void;
  refresh: () => void;
};

export const inertScanHost: ScanHost = {
  port: inertSensors,
  scan: () => null,
  ticks: () => ({ describe: false, sensors: false, ticked: null }),
  setTicks: () => {},
  runState: () => NO_RUN,
  running: () => false,
  run: () => {},
  stop: () => {},
  refresh: () => {},
};

export type Explorer = {
  toggleTree: () => void;
  carry: () => Carried;
  openSelectedInEditor: () => void;
  openLinkedView: () => void;
  refreshResponsibilities: () => void;
  refreshPanel: () => void;
  show: (target: ShowTarget) => void;
  dispose: () => void;
};

type ChangeInfo =
  | {
      name: string;
      range: string;
      state: "loading" | "unavailable" | "head-missing" | "base-unknown";
    }
  | {
      name: string;
      range: string;
      state: "ok";
      marked: MarkedModule[];
      unmatched: number;
      at: number;
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
  scanHost: ScanHost = inertScanHost,
  showMetrics: (text: string | null) => void = () => {},
): Explorer {
  const health = computeHealth(loaded);
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
  const overlayModel = buildOverlayModel(
    loaded.overlays ?? [],
    scansCommit(scans),
  );
  let metricTicks = pruneTicks(
    carried?.metricTicks ?? [],
    overlayModel.metrics,
  );
  let leftPanel: LeftPanel = carried?.leftPanel ?? "files";
  let recentNames: string[] = [];
  let viewFacts = new Map<string, ChangeFacts | null>();
  let changeInfo: ChangeInfo | null = null;
  let overlayCache: {
    info: ChangeInfo;
    scene: Scene;
    value: ChangeOverlay;
  } | null = null;
  const baseScanCache = new Map<string, Scan[] | null>();
  const undoable: { name: string; text: string }[] = [];
  let scanConfig: string | null = null;
  let shippedSensors: ShippedSensors | null = null;
  let scanEditMessage: string | null = null;
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
  let noteFocus: NoteFocus | null = null;
  let notesShown = false;
  let canvasNotes: CanvasNotes | undefined;
  let canvasNotesKey = "";
  const allFindings = findingRows(health.documents);
  let orientedFinding: string | null = null;
  let findingFilter: FindingFilter = { by: "all" };
  let canvasOrientation: CanvasOrientation | null = null;
  let canvasOrientationKey = "";
  let canvasGhosts: Ghost[] | undefined;

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
        orientedFinding = null;
        noteFocus = null;
        state.clear();
        changed();
      },
      setShowInferred(show) {
        state.setShowInferred(show);
        changed();
      },
      toggleMetric(key) {
        metricTicks = metricTicks.includes(key)
          ? metricTicks.filter((tick) => tick !== key)
          : [...metricTicks, key];
        render();
      },
      openContents() {
        inspectorOpen = true;
        inspectorTab = "contents";
        render();
      },
      openInEditor: openSelectedInEditor,
      addNote: openBubbleForSelection,
      toggleNotes() {
        notesShown = !notesShown;
        render();
      },
      openNote(path) {
        if (noteFocus?.path === path) {
          noteFocus = null;
          render();
        } else {
          openBubble(path, false);
        }
      },
      editNote: (path) => openBubble(path, true),
      cancelNote(path) {
        const view = openViewValue();

        noteFocus =
          view !== null && noteAt(view, path) !== null
            ? { path, editing: false }
            : null;
        render();
      },
      saveNote: saveNoteAt,
      removeNoteAt: removeNotePath,
      removeNote() {
        if (noteFocus !== null) {
          removeNotePath(noteFocus.path);
        }
      },
      stepNote(path) {
        orientNote(path);
      },
      walkNotes(delta) {
        const next = walkNotes(noteRowsNow(), noteFocus?.path ?? null, delta);

        if (next !== null) {
          orientNote(next);
        }
      },
      walkFindings(delta) {
        const next = walkFindings(shownFindings(), orientedFinding, delta);

        if (next !== null) {
          orientFinding(next);
        }
      },
      pickName,
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
    pickName,
    focusFinding: toggleFinding,
    focusedFinding: () => orientedFinding,
    openEvidence: openEvidence,
    copyFinding: (id) => void views.copy(id),
    metricFor: metricOffered,
    showMetric,
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
  let layoutNoted = "";
  let pendingLanding: string | null = null;

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
      land();
      render();
    },
    (message) => {
      endLayout();
      layoutNotice = `Layout failed: ${message}`;
      render();
    },
  );

  const bar = buildViewBar({
    back,
    forward,
    openView: (name) => void openSaved(name),
    openViewsPanel: toggleViewsPanel,
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
  const viewsPanel = buildViewsPanelView({
    open: (name) => void openSaved(name),
    remove: (name) => void removeSavedView(name),
  });
  const notesPanel = buildNotesPanelView({
    toggle: toggleNote,
    remove: (path) => removeNotePath(path),
    moveNote: (path, toIndex) =>
      reorderNotes(`reordered the notes`, (view) =>
        withNoteMoved(view, path, toIndex),
      ),
    setOrdered: (ordered) =>
      reorderNotes(
        ordered
          ? "set the notes to read in order"
          : "set the notes to read in no order",
        (view) => withOrder(view, { ...orderOf(view), ordered }),
      ),
  });
  const scanView = buildScanPanelView({
    tickDescribe(ticked) {
      scanHost.setTicks({ ...scanHost.ticks(), describe: ticked });
      render();
    },
    tickSensors(ticked) {
      scanHost.setTicks({ ...scanHost.ticks(), sensors: ticked });
      render();
    },
    tickSensor(name, ticked) {
      const names = registeredNames(scanConfig);
      const held = scanHost.ticks().ticked ?? names;
      const rest = held.filter((one) => one !== name);

      scanHost.setTicks({
        ...scanHost.ticks(),
        ticked: ticked ? [...rest, name] : rest,
      });
      render();
    },
    run: () => scanHost.run(),
    stop: () => scanHost.stop(),
    addSensor: (name) => void editSensor(name, true),
    removeSensor: (name) => void editSensor(name, false),
    clearReport: (name) => void clearReport(name),
  });
  const findingsView = buildFindingsPanelView({
    toggle: toggleFinding,
    openInEditor: openEvidence,
    copyId: (id) => void views.copy(id),
    metricFor: metricOffered,
    showMetric,
    filter(next) {
      findingFilter = next;
      render();
    },
    openSensors() {
      leftPanel = "scan";
      render();
      void loadScanConfig();
    },
  });
  const rail = buildRailView({
    toggleFiles: toggleTree,
    toggleViews: toggleViewsPanel,
    toggleNotes: openNotes,
    toggleScan: toggleScanPanel,
    toggleFindings: toggleFindingsPanel,
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
  tree.element.append(
    viewsPanel.element,
    notesPanel.element,
    scanView.element,
    findingsView.element,
  );
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

  function trailFit(): PanelFit {
    const width = body.clientWidth;

    if (width === 0) {
      return { cap: MAX_PANELS, width: widths.inspector };
    }

    const tree = leftPanel === null ? 0 : widths.tree;
    const available = width - RAIL_WIDTH - tree - CANVAS_FLOOR;

    return panelCapacity(available, widths.inspector, trail.panels.length);
  }

  function trailCapacity(): number {
    return trailFit().cap;
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
    layoutNoted = notedKey();
    layout.request(toElk(graph, measure, notedBoxes(), metricTicks.length));
    render();
  }

  function notedBoxes(): ReadonlySet<string> {
    const view = openViewValue();

    return view === null ? new Set<string>() : notedPaths(view);
  }

  function notedKey(): string {
    return `${metricTicks.length}|${[...notedBoxes()].sort().join("\n")}`;
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

    dropNoteFocusUnlessKept(selection);
    dropFocusUnlessKept(selection);

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

  function dropFocusUnlessKept(selection: Selection) {
    const row = allFindings.find((one) => one.id === orientedFinding);

    if (row === undefined || !keepsFocus(selection, row.record, boxFor)) {
      orientedFinding = null;
    }
  }

  function pickName(id: string) {
    if (!modules.isOpen(id)) {
      modules.open(id);
      changed();
    }

    canvas.centerOn(boxFor(id));
  }

  function metricOffered(record: FindingRecord) {
    const found = currentMetricNamed(record.metric, overlayModel.metrics);

    return found === null ? null : { key: found.key, label: found.label };
  }

  function showMetric(key: string) {
    if (!metricTicks.includes(key)) {
      metricTicks = [...metricTicks, key];
      render();
    }
  }

  function toggleFinding(id: string) {
    if (orientedFinding === id) {
      clearFocus();
    } else {
      orientFinding(id);
    }
  }

  function clearFocus() {
    orientedFinding = null;
    render();
  }

  function openEvidence(module: string, line: number | null) {
    void editor
      .openFile(module, line ?? undefined)
      .catch((error) =>
        notify(String(error instanceof Error ? error.message : error)),
      );
  }

  function find(id: string) {
    dropNoteFocusUnlessKept({ kind: "module", id });
    dropFocusUnlessKept({ kind: "module", id });

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

  function toggleViewsPanel() {
    leftPanel = leftPanel === "views" ? null : "views";
    render();

    if (leftPanel === "views") {
      void refreshFacts();
    }
  }

  async function refreshFacts() {
    const next = new Map<string, ChangeFacts | null>();

    await Promise.all(
      viewList.map(async ({ name, text }) => {
        const parsed = parseViewFile(text);

        if (!parsed.ok || parsed.view.change === undefined) {
          return;
        }

        const range = await views
          .changeRange(parsed.view.change.base, parsed.view.change.head)
          .catch(() => null);

        next.set(
          name,
          range === null
            ? null
            : {
                headCommit: range.headCommit,
                baseCommit: range.baseCommit,
                merged: range.merged,
              },
        );
      }),
    );

    viewFacts = next;
    render();
  }

  async function removeSavedView(name: string) {
    const text = viewList.find((entry) => entry.name === name)?.text;

    if (text === undefined) {
      return;
    }

    try {
      await views.remove(name);
    } catch (error) {
      notify(`Could not delete ${name}: ${String(error)}`);

      return;
    }

    undoable.push({ name, text });
    showUndo();
    await loadViewList();
    render();
  }

  function showUndo() {
    const top = undoable[undoable.length - 1];

    if (top === undefined) {
      showAgentLine(null);

      return;
    }

    showAgentLine({
      text: `Deleted ${top.name}`,
      onUndo() {
        undoable.pop();
        void views
          .write(top.name, top.text)
          .then(() => loadViewList())
          .then(() => {
            render();
            showUndo();
          })
          .catch((error) =>
            notify(`Could not restore ${top.name}: ${String(error)}`),
          );
      },
    });
  }

  async function loadRecent() {
    recentNames = await views.recent().catch(() => []);
    renderBar();
  }

  function noteOpened(name: string) {
    void views
      .recordOpened(name)
      .then(() => loadRecent())
      .catch(() => {});
  }

  async function loadChange(name: string, view: View, token: number) {
    if (view.change === undefined) {
      changeInfo = null;

      return;
    }

    const range = rangeText(view.change);

    changeInfo = { name, range, state: "loading" };
    render();

    const answer = await views
      .changeRange(view.change.base, view.change.head)
      .catch(() => null);

    if (token !== openToken) {
      return;
    }

    if (answer === null) {
      changeInfo = { name, range, state: "unavailable" };
      render();

      return;
    }

    if (answer.headCommit === null) {
      changeInfo = { name, range, state: "head-missing" };
      render();

      return;
    }

    if (answer.baseCommit === null) {
      changeInfo = { name, range, state: "base-unknown" };
      render();

      return;
    }

    const files: FileChange[] = [];

    for (const change of answer.changes) {
      if (
        change.status === "A" ||
        change.status === "M" ||
        change.status === "D" ||
        change.status === "T"
      ) {
        files.push({ status: change.status, path: change.path });
      }
    }

    const present = scans as unknown as MarkScan[];
    let found = changeMarks(files, present, null);

    if (found.modules.some((one) => one.mark === "removed")) {
      const baseScans =
        answer.baseCommit === currentCommit(scans)
          ? present
          : ((await baseScansAt(answer.baseCommit)) as MarkScan[] | null);

      if (token !== openToken) {
        return;
      }

      found = changeMarks(files, present, baseScans);
    }

    for (const one of found.modules) {
      if (one.box === "current" && knownModules.has(one.id)) {
        modules.open(one.id);
      }
    }

    changeInfo = {
      name,
      range,
      state: "ok",
      marked: found.modules,
      unmatched: found.unmatched,
      at: Date.now(),
    };
    rebuild();
    render();
  }

  async function baseScansAt(commit: string): Promise<Scan[] | null> {
    if (!baseScanCache.has(commit)) {
      baseScanCache.set(commit, await views.scansAt(commit).catch(() => null));
    }

    return baseScanCache.get(commit) ?? null;
  }

  function changeOverlay(): ChangeOverlay | null {
    const info = changeInfo;

    if (
      info === null ||
      info.state !== "ok" ||
      info.name !== openView ||
      scene === null
    ) {
      return null;
    }

    if (
      overlayCache !== null &&
      overlayCache.info === info &&
      overlayCache.scene === scene
    ) {
      return overlayCache.value;
    }

    const value: ChangeOverlay = {
      marks: new Map(info.marked.map((one) => [one.id, one.mark])),
      removed: removedPlacement(
        scene,
        info.marked
          .filter((one) => one.mark === "removed" && one.box === "base")
          .map((one) => one.id),
      ),
    };

    overlayCache = { info, scene, value };

    return value;
  }

  function changeFooter(): string {
    const info = changeInfo;

    if (info === null || info.name !== openView) {
      return "";
    }

    switch (info.state) {
      case "loading":
        return "";
      case "unavailable":
        return ` · git could not diff ${info.range}`;
      case "head-missing":
        return ` · head ${info.range.slice(info.range.indexOf("..") + 2)} is not in the repository`;
      case "base-unknown":
        return ` · base ${info.range.slice(0, info.range.indexOf(".."))} is not in the repository`;
      case "ok": {
        const noBox = info.marked.filter((one) => one.box === "none").length;
        const extra = [
          ...(info.unmatched > 0
            ? [`${info.unmatched} changed files matched no module`]
            : []),
          ...(noBox > 0 ? [`${noBox} removed modules have no box`] : []),
        ];

        return ` · diffed against ${info.range} ${ageText(info.at, Date.now())}${
          extra.length === 0 ? "" : ` (${extra.join(", ")})`
        }`;
      }
    }
  }

  function toggleFindingsPanel() {
    leftPanel = leftPanel === "findings" ? null : "findings";
    render();
  }

  function shownFindings(): FindingRow[] {
    return applyFilter(allFindings, findingFilter);
  }

  function orientFinding(id: string) {
    const row = allFindings.find((one) => one.id === id);

    if (row === undefined) {
      return;
    }

    if (!modules.isOpen(row.module)) {
      modules.open(row.module);
      rebuild();
    }

    if (!keepsFocus(state.selection(), row.record, boxFor)) {
      select({ kind: "module", id: row.module });
    }

    orientedFinding = id;
    canvas.centerOn(boxFor(state.selection()?.id ?? row.module));
    render();
  }

  function syncOrientation(): CanvasOrientation | null {
    const row = allFindings.find((one) => one.id === orientedFinding);

    if (row === undefined) {
      orientedFinding = null;
      canvasOrientation = null;
      canvasOrientationKey = "";
      canvasGhosts = undefined;

      return null;
    }

    if (scene === null) {
      return null;
    }

    const boxIds = new Set(scene.boxes.map((box) => box.id));
    const lines = scene.lines.map((line) => line.id);
    const lit = litSet(row.record, boxFor, lines, boxIds);
    const ghosts = ghostPlacement(row.record, boxFor, scene);
    const key = JSON.stringify([row.id, [...lit].sort(), ghosts]);

    if (key !== canvasOrientationKey || canvasOrientation === null) {
      canvasOrientationKey = key;
      canvasOrientation = { lit, tone: row.severity };
      canvasGhosts = ghosts.length > 0 ? ghosts : undefined;
    }

    return canvasOrientation;
  }

  function toggleScanPanel() {
    leftPanel = leftPanel === "scan" ? null : "scan";
    scanEditMessage = null;
    render();

    if (leftPanel === "scan") {
      void loadScanConfig();
    }
  }

  async function loadScanConfig() {
    try {
      scanConfig = (await scanHost.port.readInputs()).config;
    } catch {
      scanConfig = null;
    }

    if (leftPanel === "scan" || shippedSensors !== null) {
      try {
        shippedSensors = await scanHost.port.shipped();
      } catch (error) {
        shippedSensors = { status: "unavailable", reason: String(error) };
      }
    }

    render();
  }

  async function editSensor(name: string, add: boolean) {
    try {
      await scanHost.port.edit(name, add);
      scanEditMessage = null;
    } catch (error) {
      scanEditMessage = error instanceof Error ? error.message : String(error);
    }

    await loadScanConfig();
  }

  async function clearReport(name: string) {
    try {
      await scanHost.port.removeFindings([name]);
      scanEditMessage = null;
    } catch (error) {
      scanEditMessage = error instanceof Error ? error.message : String(error);
    }

    scanHost.refresh();
    await loadScanConfig();
  }

  function structureCounts() {
    const rows = allFindings.filter((row) => row.sensor === "structure");

    return {
      violations: rows.filter((row) => row.severity === "violation").length,
      warnings: rows.filter((row) => row.severity === "warning").length,
    };
  }

  function scanModel() {
    return scanPanel({
      scan: scanHost.scan(),
      scanFiles: loaded.scans.map(({ file }) => file),
      counts: {
        modules: loaded.modules.length,
        edges: scans.reduce((total, scan) => total + scan.edges.length, 0),
      },
      config: scanConfig,
      sensors: loaded.sensors,
      structure: structureCounts(),
      lines: { modules: loaded.modules, of: responsibilityOf },
      ticks: scanHost.ticks(),
      run: scanHost.runState(),
      scanning: scanHost.running(),
      now: Date.now(),
      shipped: shippedSensors,
      editMessage: scanEditMessage,
    });
  }

  function showTarget(target: ShowTarget) {
    if (target.kind === "sensor") {
      leftPanel = "scan";
      render();
      scanView.reveal(target.name);
      void loadScanConfig();

      return;
    }

    if (!knownModules.has(target.id)) {
      return;
    }

    describing.finish(target.id, { status: "failed", reason: target.reason });
    inspectorOpen = true;
    inspectorTab = "contents";
    select({ kind: "module", id: target.id });
  }

  function openNotes() {
    leftPanel = leftPanel === "notes" ? null : "notes";
    render();
  }

  function dropNoteFocusUnlessKept(selection: Selection) {
    if (noteFocus !== null && !keepsNoteFocus(selection, noteFocus)) {
      noteFocus = null;
    }
  }

  function selectionOf(path: string): Selection {
    return path.endsWith("/")
      ? { kind: "folder", id: path.slice(0, -1) }
      : { kind: "module", id: path };
  }

  function openBubbleForSelection() {
    const path = notePathOf(state.selection());

    if (path !== null) {
      openBubble(path, false);
    }
  }

  function openBubble(path: string, edit: boolean) {
    const view = openViewValue();

    if (view === null || !notePositions().has(path)) {
      return;
    }

    select(selectionOf(path));
    noteFocus = { path, editing: edit || noteAt(view, path) === null };
    render();
  }

  function saveNoteAt(path: string, text: string) {
    void writeNote(async (view) => setNote(view, path, text, author)).then(
      () => {
        if (noteFocus?.path === path) {
          noteFocus = { path, editing: false };
        }

        render();
      },
    );
  }

  function toggleNote(path: string) {
    if (noteFocus?.path === path) {
      noteFocus = null;
      render();
    } else {
      orientNote(path);
    }
  }

  function land() {
    if (pendingLanding === null) {
      return;
    }

    const name = pendingLanding;

    pendingLanding = null;

    const view = openViewValue();

    if (view === null || openView !== name || !isOrdered(view)) {
      return;
    }

    const positions = notePositions();
    const first = viewNotes(view).find((note) => positions.has(note.module));

    if (first !== undefined) {
      orientNote(first.module, false);
    }
  }

  function notePositions(): Map<string, Rect> {
    const positions = new Map<string, Rect>();

    for (const frame of scene?.frames ?? []) {
      positions.set(`${frame.path}/`, frame.rect);
    }

    for (const box of scene?.boxes ?? []) {
      positions.set(box.kind === "folder" ? `${box.id}/` : box.id, box.rect);
    }

    return positions;
  }

  function noteRowsNow(): NoteRow[] {
    const view = openViewValue();

    return view === null
      ? []
      : noteRows(view, notePositions(), noteFocus?.path ?? null);
  }

  function orientNote(path: string, animate = true) {
    const view = openViewValue();

    if (view === null || noteAt(view, path) === null) {
      return;
    }

    if (!notePositions().has(path)) {
      return;
    }

    select(selectionOf(path));
    noteFocus = { path, editing: false };

    if (isOrdered(view)) {
      canvas.walkTo(path, { animate });
    } else {
      canvas.centerOn(boxFor(path.endsWith("/") ? path.slice(0, -1) : path));
    }

    render();
  }

  function reorderNotes(summary: string, change: (view: View) => View) {
    const name = openView;
    const view = openViewValue();

    if (name === null || view === null) {
      return;
    }

    const before = orderOf(view);
    let after: OrderState = before;

    void writeNote(async (current) => {
      const next = change(current);

      after = orderOf(next);

      return next;
    }).then(() => {
      if (JSON.stringify(before) === JSON.stringify(after)) {
        return;
      }

      const mark: Mark = {
        by: author,
        summary,
        order: { view: name, before, after },
      };

      history.record(snapshot(), mark);
      agentLine.show(mark, back);
      publish();
      renderBar();
    });
  }

  async function restoreOrder(view: string, state: OrderState) {
    const current = viewNamed(view);

    if (current === null) {
      return;
    }

    await writeView(view, withOrder(current, state));
    renderBar();
    render();
  }

  function removeNotePath(path: string) {
    const name = openView;
    const view = openViewValue();
    const held = view === null ? null : noteAt(view, path);

    if (name === null || held === null) {
      return;
    }

    if (noteFocus?.path === path) {
      noteFocus = null;
    }

    void writeNote(async (current) => withoutNote(current, path)).then(() => {
      const mark: Mark = {
        by: author,
        summary: `removed the note on ${path}`,
        note: { view: name, path, text: held.text, by: held.by },
      };

      history.record(snapshot(), mark);
      agentLine.show(mark, back);
      publish();
      renderBar();
    });
  }

  function back() {
    const mark = history.markNow();

    step(history.back());

    if (mark?.note !== undefined) {
      void restoreNote(mark.note);
    }

    if (mark?.order !== undefined) {
      void restoreOrder(mark.order.view, mark.order.before);
    }
  }

  function forward() {
    step(history.forward());

    const mark = history.markNow();

    if (mark?.note !== undefined) {
      void dropNote(mark.note);
    }

    if (mark?.order !== undefined) {
      void restoreOrder(mark.order.view, mark.order.after);
    }
  }

  async function restoreNote(note: NonNullable<Mark["note"]>) {
    const view = viewNamed(note.view);

    if (view === null || noteAt(view, note.path) !== null) {
      return;
    }

    await writeView(note.view, setNote(view, note.path, note.text, note.by));
    renderBar();
    render();
  }

  async function dropNote(note: NonNullable<Mark["note"]>) {
    const view = viewNamed(note.view);

    if (view === null || noteAt(view, note.path) === null) {
      return;
    }

    await writeView(note.view, withoutNote(view, note.path));
    renderBar();
    render();
  }

  function selectionNotes(
    selection: NonNullable<Selection>,
  ): { noted: boolean } | null {
    const view = openViewValue();
    const path = notePathOf(selection);

    return path !== null && view !== null
      ? { noted: noteAt(view, path) !== null }
      : null;
  }

  function barOf(selection: Selection): BarModel | null {
    if (selection === null || selection.kind === "edge") {
      return null;
    }

    const counts = graph.counts(selection);

    return {
      kind: selection.kind,
      dependencies: counts.uses + counts.usedBy,
      notes: selectionNotes(selection),
      findings: findingsTone(selection, {
        findings: health.findings,
        modules: loaded.modules,
      }),
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
      void loadRecent();

      if (leftPanel === "views") {
        void refreshFacts();
      }
    } catch (error) {
      listNotice = `Could not list saved views: ${String(error)}`;
      listProblem = String(error);
      listKnown = false;
      renderBar();
    }

    renderNotices();
  }

  function viewNamed(name: string): View | null {
    const text =
      viewTexts.get(name) ??
      viewList.find((entry) => entry.name === name)?.text;
    const parsed = text === undefined ? null : parseViewFile(text);

    return parsed?.ok ? parsed.view : null;
  }

  function openViewValue(): View | null {
    return openView === null ? null : viewNamed(openView);
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
      views: dropdownNames(
        viewList.map((entry) => entry.name),
        recentNames,
      ).map((name) => {
        const parsed = parseViewFile(
          viewList.find((entry) => entry.name === name)?.text ?? "",
        );

        return {
          name,
          description: parsed.ok ? parsed.view.description : null,
          chip: parsed.ok ? chipOf(parsed.view) : null,
        };
      }),
      names: viewList.map((entry) => entry.name),
      total: viewList.length,
      openChip: openChipOf(),
      canBack: history.canBack(),
      listed: listKnown,
      listProblem,
      canForward: history.canForward(),
      backLabel: backLabel(history.markNow()),
      forwardLabel: forwardLabel(history.markNext()),
      canCopy: openView !== null,
    });
  }

  function openChipOf(): string | null {
    const view = openViewValue();

    return view?.change === undefined ? null : rangeText(view.change);
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

  async function applyView(
    name: string,
    text: string,
    withRenames: boolean,
    landing = false,
  ) {
    const parsed = parseViewFile(text);

    if (!parsed.ok) {
      viewNotice = `${name} is not a valid view: ${parsed.reason}`;
      renderNotices();

      return;
    }

    const { view } = parsed;

    for (const warning of parsed.warnings) {
      notify(`${name}: ${warning}`);
    }

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
    pendingLanding =
      landing && isOrdered(view) && viewNotes(view).length > 0 ? name : null;
    changeInfo = null;
    setCanvas(
      [...resolved.modules, ...renamed],
      resolved.folded,
      resolved.focus,
    );
    noteOpened(name);
    void loadChange(name, view, token);
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
    void loadChange(name, parsed.view, token);
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
      await applyView(name, text, true, true);
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
      schema_version: 4,
      description,
      commit: currentCommit(scans),
      steps: stepsFor([], canvasContent(), scans),
    });

    if (problem === null) {
      reports.delete(name);
      openView = name;
      record();
      noteOpened(name);
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

    if (notedKey() !== layoutNoted) {
      queueMicrotask(() => {
        if (notedKey() !== layoutNoted) {
          layoutNoted = notedKey();
          endLayoutBusy ??= layoutGate.begin();
          layout.request(
            toElk(graph, measure, notedBoxes(), metricTicks.length),
          );
        }
      });
    }
    const positions = notePositions();

    if (noteFocus !== null) {
      const held = view === null ? null : noteAt(view, noteFocus.path);

      if (view === null || !positions.has(noteFocus.path)) {
        noteFocus = null;
      } else if (held === null && !noteFocus.editing) {
        noteFocus = null;
      }
    }

    const focus = noteFocus;
    const held =
      view === null || focus === null ? null : noteAt(view, focus.path);
    const bubbles = bubbleSet(view, positions, focus, notesShown);
    const marks = view === null ? new Set<string>() : notedPaths(view);
    const ordered = view !== null && isOrdered(view);
    const numbers = ordered
      ? new Map(viewNotes(view).map((note, index) => [note.module, index + 1]))
      : null;
    const keys = {
      notesOpen: leftPanel === "notes",
      noteActive: held !== null,
      findingsOpen: leftPanel === "findings",
      stepping: ordered && held !== null && focus?.editing === false,
    };
    const key = JSON.stringify([
      [...marks].sort(),
      numbers === null ? null : [...numbers],
      focus,
      bubbles,
      notesShown,
      keys,
    ]);

    if (key !== canvasNotesKey || canvasNotes === undefined) {
      canvasNotesKey = key;
      canvasNotes = {
        marks,
        numbers,
        active: focus?.path ?? null,
        bubbles,
        showAll: notesShown,
        keys,
      };
    }

    return canvasNotes;
  }

  function tooltipOf(id: string): TooltipLine[] {
    const view = openViewValue();
    const held = view === null ? null : noteAt(view, id);

    return boxTooltip(responsibilityOf(id), held?.text ?? null);
  }

  function tickedMetrics(): MetricDescriptor[] {
    return metricTicks.flatMap((key) =>
      overlayModel.metrics.filter((metric) => metric.key === key),
    );
  }

  function canvasMetrics(): CanvasMetrics {
    const ticked = tickedMetrics();

    showMetrics(footerText(ticked));

    return {
      groups: overlayModel.groups,
      ticked,
      valueOf: (metric, boxId) => moduleValue(metric, boxId),
    };
  }

  function renderCanvas() {
    const notes = syncNotes();

    onCount(
      `${modules.count()} of ${modules.total()} modules on the canvas${changeFooter()}`,
    );

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
      tooltip: tooltipOf,
      orientation: syncOrientation(),
      ghosts: canvasGhosts,
      metrics: canvasMetrics(),
      changes: changeOverlay(),
    });
  }

  function render() {
    const filtered = filterTree(root, filter, context);
    const selection = state.selection();

    syncTrail(selection);
    body.classList.toggle("tree-hidden", leftPanel === null);
    tree.element.classList.toggle("views-open", leftPanel === "views");
    tree.element.classList.toggle("notes-open", leftPanel === "notes");
    tree.element.classList.toggle("scan-open", leftPanel === "scan");
    tree.element.classList.toggle("findings-open", leftPanel === "findings");

    const noteView = openViewValue();
    const noteTotal = noteView === null ? 0 : viewNotes(noteView).length;

    const scanModelNow = scanModel();

    scanView.render(scanModelNow);
    viewsPanel.render(
      leftPanel === "views"
        ? viewsPanelModel(viewList, scans, viewFacts)
        : null,
      openView,
    );

    const findingChips = chips(allFindings);

    if (!findingChips.some((chip) => sameFilter(chip.filter, findingFilter))) {
      findingFilter = { by: "all" };
    }

    const shown = shownFindings();

    findingsView.render({
      chips: findingChips,
      filter: findingFilter,
      stale: staleNote(scanModelNow.sensors.rows, scanModelNow.sensors.reports),
      groups: groupFindings(shown),
      active: orientedFinding,
      empty:
        allFindings.length === 0
          ? "No findings for this scan."
          : shown.length === 0
            ? "No findings match this filter."
            : null,
    });
    rail.render({
      panel: leftPanel,
      notes: noteTotal,
      scanFailed: scanModelNow.mark,
      findings: badge(allFindings),
    });
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
      rows: noteRowsNow(),
      ordered: noteView === null || isOrdered(noteView),
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
        findingRows: (id) =>
          allFindings.filter((one) => one.record.evidence.modules.includes(id)),
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
        folderMetrics: (folder) =>
          loaded.folderMetrics.find((row) => row.id === folder) ?? null,
        distanceThreshold: loaded.distanceThreshold,
        responsibility: (id) => ({
          state: responsibilityOf(id),
          busy: describing.busy(id),
          failure: describing.failure(id),
        }),
        metrics: overlayModel.metrics.filter((metric) => !metric.stale),
      });
    };

    lastContents = trail.panels.map((_, index) => contentOf(index));

    const placed = trailLayout(trail);
    const multi = inspectorOpen && trail.panels.length > 1;

    body.style.setProperty("--inspector-w", `${trailFit().width}px`);
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

  for (const name of [
    ...(loaded.overlaysUnreadable ?? []),
    ...overlayModel.unreadable,
  ]) {
    notify(`Overlay ${name} could not be read`);
  }

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
  void loadScanConfig();

  void loadViewList().then(() => {
    if (carried?.snapshot.view != null) {
      void recompare(carried.snapshot.view);
    }
  });

  function openSelectedInEditor() {
    void openInEditor(state.selection(), editor, notify);
  }

  const onUndoKey = (event: KeyboardEvent) => {
    if (
      (event.metaKey || event.ctrlKey) &&
      !event.shiftKey &&
      !event.altKey &&
      event.key.toLowerCase() === "z" &&
      !isEditable(event.target) &&
      history.canBack()
    ) {
      event.preventDefault();
      back();
    }
  };

  document.addEventListener("keydown", onUndoKey);

  return {
    toggleTree,
    openSelectedInEditor,
    openLinkedView: () => void openLinkedView(),
    refreshResponsibilities: () => void readResponsibilities(),
    refreshPanel: () => render(),
    show: showTarget,
    carry: () => ({ history, snapshot: snapshot(), leftPanel, metricTicks }),
    dispose() {
      document.removeEventListener("keydown", onUndoKey);
      resizeObserver?.disconnect();
      stopWatching();
      stopDriving();
      agentLine.clear();
      stopWatchingResponsibilities();
      bar.dispose();
    },
  };
}
