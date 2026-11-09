import {
  buildFreshness,
  type ChangeFacts,
  changeMarks,
  type FileChange,
  folderUsedBy,
  folderUses,
  type MarkedModule,
  type MarkScan,
  type MemberMarkKind,
  memberMarks,
  rangeText,
  resolveView,
  type Scan,
  usedByOf,
  usesOf,
  type View,
  viewNotes,
} from "recognizer";
import { agentLineOf, backLabel, forwardLabel } from "./agent-line";
import { type Scheduler, timerScheduler } from "./bar-hover";
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
import { describeLine } from "./edge-evidence";
import { openFolderInEditor, openInEditor } from "./editor-open";
import { type EditorPort, inertEditor } from "./editor-port";
import { cardOf } from "./finding-card";
import { keepsFocus } from "./finding-focus";
import { litSet } from "./findings-card";
import {
  groupsOf,
  headerLine,
  SENSOR_GROUPS,
  withEmptyGroups,
} from "./findings-groups";
import { badge, findingRows, walkFindings } from "./findings-order";
import { buildFindingsPanelView } from "./findings-panel-view";
import { scopeCaption, scopedRows, scopeOf } from "./findings-scope";
import { compactFolders } from "./folder-compaction";
import { ageText, type ScanState } from "./footer-scan";
import {
  type FreshnessModel,
  findingsActionOf,
  hiddenText,
} from "./freshness-model";
import { limitsFromText } from "./function-limits";
import { computeHealth, describeTree } from "./health";
import {
  emphasisedLines,
  findingsTone,
  flatRows,
  followableRows,
  type InspectorContent,
  type InspectorMembers,
  type InspectorTab,
  inspectorContent,
  shortMetric,
} from "./inspector-model";
import { buildInspectorView, type InspectorActions } from "./inspector-view";
import {
  createLayoutSource,
  layoutOnMainThread,
  startLayoutWorker,
} from "./layout-source";
import type { MessageInput, MessageKind } from "./message-tray";
import { memberSources } from "./metric-bars";
import type { CanvasMetrics } from "./metrics-view";
import { descriptionOf } from "./module-tip";
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
  applyFreshness,
  buildOverlayModel,
  freshnessNote,
  type MetricDescriptor,
  moduleValue,
  type OverlayModel,
  pruneTicks,
} from "./overlay-model";
import { mountPanelResizers } from "./panel-resizer-view";
import { type PlanOverlay, planOverlay } from "./plan-overlay";
import { buildRailView, type LeftPanel } from "./rail-view";
import { removedPlacement } from "./removed-boxes";
import {
  inertResponsibilities,
  type ResponsibilitiesPort,
} from "./responsibilities-port";
import {
  createDescribing,
  type EffectiveDescriber,
  NO_FILES,
  type ResponsibilityState,
  responsibilityStates,
} from "./responsibility-model";
import { nextCheck } from "./row-model";
import {
  freshnessMessage,
  type PlannedRun,
  type ResultsMode,
} from "./scan-freshness";
import type { Loaded } from "./scan-loading";
import {
  DESCRIBE_KEY,
  NO_RUN,
  type RunState,
  rowSensors,
  type ScanTicks,
  scanPanel,
} from "./scan-panel-model";
import { buildScanPanelView } from "./scan-panel-view";
import type {
  DescribeAsk,
  DescribeStop,
  SensorProgress,
  ShowTarget,
} from "./scan-progress";
import type { BarModel } from "./selection-bar-view";
import {
  inertSensors,
  type SensorsPort,
  type ShippedSensors,
} from "./sensor-run";
import { loadShowPrivate, saveShowPrivate } from "./show-private";
import { currentCommit, hasEntries, staleReport } from "./stale-report";
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
import { buildUnsavedDialog, type UnsavedChoice } from "./unsaved-dialog-view";
import { buildViewBar } from "./view-bar-view";
import {
  createViewComparisons,
  type ViewComparisons,
} from "./view-comparisons";
import { parseViewFile, serialiseView } from "./view-file";
import type { Heading } from "./view-heading";
import {
  createHistory,
  type History,
  type Mark,
  type OrderState,
} from "./view-history";
import { resolveLinkedView } from "./view-link";
import { viewModified } from "./view-modified";
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
import type { Viewport } from "./viewport";
import { dropdownNames, rangeOf, viewsPanelModel } from "./views-panel-model";
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
  camera?: Viewport | null;
};

export type ScanHost = {
  port: SensorsPort;
  scan: () => ScanState | null;
  ticks: () => ScanTicks;
  setTicks: (next: ScanTicks) => void;
  runState: () => RunState;
  running: () => boolean;
  progressText: () => string | null;
  footer?: (text: string | null) => void;
  sensorProgress?: () => SensorProgress | null;
  extracting?: () => boolean;
  describeProgress: () => { entries: number; total: number } | null;
  describeStop: () => DescribeStop | null;
  describeAsk: () => DescribeAsk | null;
  describeSkipped: () => boolean;
  answerDescribe: (describe: boolean) => void;
  run: (modules: string[] | null, planned?: PlannedRun) => void;
  stop: () => void;
  refresh: () => void;
};

export const inertScanHost: ScanHost = {
  port: inertSensors,
  scan: () => null,
  ticks: () => ({ describe: false, ticked: null, once: [], onlyView: false }),
  setTicks: () => {},
  runState: () => NO_RUN,
  running: () => false,
  progressText: () => null,
  describeProgress: () => null,
  describeStop: () => null,
  describeAsk: () => null,
  describeSkipped: () => false,
  answerDescribe: () => {},
  run: () => {},
  stop: () => {},
  refresh: () => {},
};

export type Explorer = {
  toggleTree: () => void;
  carry: () => Carried;
  update: (loaded: Loaded) => void;
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
      headCommit: string;
      members: ChangeMembers;
    };

type ChangeMembers =
  | "loading"
  | null
  | {
      marks: Map<string, Map<string, MemberMarkKind> | null>;
      start: Scan[];
    };

function freshnessOf(loaded: Loaded) {
  return buildFreshness(
    loaded.scans.map(({ scan }) => scan),
    loaded.tests ?? null,
  );
}

const LOSS_WARNING =
  "Your changes since it was saved will be lost unless you save them.";
const CLEAR_BODY = `Clearing closes the view. ${LOSS_WARNING}`;
const SENSOR_LOG = ".recognizer/cache/coverage/last-run.log";

export function showExplorer(
  container: HTMLElement,
  initial: Loaded,
  title: string,
  onCount: (text: string) => void = () => {},
  views: ViewsPort = inertViews,
  post: (input: MessageInput) => number | null = () => null,
  carried: Carried | null = null,
  scheduler: Scheduler = timerScheduler,
  storage: Pick<Storage, "getItem" | "setItem"> = {
    getItem: () => null,
    setItem: () => {},
  },
  editor: EditorPort = inertEditor,
  responsibilities: ResponsibilitiesPort = inertResponsibilities,
  windowPort: WindowPort = inertWindow,
  scanHost: ScanHost = inertScanHost,
  withdraw: (id: number) => void = () => {},
  reconcileMessages: (foundKeys: readonly string[]) => void = () => {},
  comparisons: ViewComparisons = createViewComparisons(),
): Explorer {
  let loaded = initial;
  let health = computeHealth(loaded);
  const knownModules = new Set(loaded.modules);
  const compaction = compactFolders(loaded.modules);
  const root = buildTree(loaded.modules, compaction);
  let described = describeTree(root, health);
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
  let overlayModel = buildOverlayModel(loaded.overlays ?? [], {
    sensors: loaded.sensors,
    shipped: null,
  });
  let metricTicks = pruneTicks(
    carried?.metricTicks ?? [],
    overlayModel.metrics,
  );
  let leftPanel: LeftPanel = carried?.leftPanel ?? "files";
  let recentNames: string[] = [];
  let viewFacts = new Map<string, ChangeFacts | null>();
  let changeInfo: ChangeInfo | null = null;
  let planCache: {
    view: View;
    scans: Scan[];
    value: PlanOverlay | null;
  } | null = null;
  let overlayCache: {
    info: ChangeInfo;
    scene: Scene;
    value: ChangeOverlay;
  } | null = null;
  const baseScanCache = new Map<string, Scan[] | null>();
  const deletionUndos = new Set<number>();
  let scanConfig: string | null = null;
  let shippedSensors: ShippedSensors | null = null;
  let describedAt: number | null = null;
  let describerSeen: {
    config: string | null;
    found: EffectiveDescriber | null;
  } | null = null;
  let scrollTarget: string | null = null;
  let graph: CanvasGraph = emptyGraph();
  let scene: Scene | null = null;
  let titles = new Map<string, string>();
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
  let openView: string | null = null;
  let resultsMode: ResultsMode = "bring";
  let runPlanned: PlannedRun | null = null;
  let freshnessCache: FreshnessModel | null = null;
  let overlaysCache: OverlayModel | null = null;
  let viewList: { name: string; text: string }[] = [];
  let viewNotice: string | null = null;
  let listNotice: string | null = null;
  const heldViewKeys = new Set<string>();
  let listKnown = false;
  let listProblem: string | null = null;
  let openToken = 0;
  const viewTexts = new Map<string, string>();
  const history =
    carried?.history ??
    createHistory<Snapshot>({
      view: null,
      modules: [],
      folded: [],
      focus: null,
      selection: null,
    });
  let historyMessage: number | null = null;
  const agentLine = {
    show(mark: Mark, undo: () => void) {
      agentLine.clear();
      historyMessage = post({
        kind: "done",
        text: agentLineOf(mark),
        action: { label: "Undo", run: undo },
      });
    },
    clear() {
      if (historyMessage !== null) {
        withdraw(historyMessage);
        historyMessage = null;
      }
    },
  };
  const fail = (text: string) => void post({ kind: "error", text });
  let batch: { touched: boolean } | null = null;
  const publishWindow = latestWins(windowPort.publish);
  let lastPublished: string | null = null;
  const authorName = views.author().catch(() => "Me");
  let author = "Me";
  let noteFocus: NoteFocus | null = null;
  let canvasNotes: CanvasNotes | undefined;
  let canvasNotesKey = "";
  let allFindings = findingRows(health.documents);
  let hiddenRows = findingRows(health.hidden);
  let orientedFinding: string | null = null;
  const openGroups = new Set<string>();
  let findingsOnlyView = false;
  let canvasOrientation: CanvasOrientation | null = null;
  let canvasOrientationKey = "";

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
    openFolderInEditor: () => void openFolderInEditor(editor, fail),
  });

  const canvas = buildCanvasView(
    {
      find,
      select,
      takeOff() {
        const selection = state.selection();

        if (
          selection?.kind === "module" &&
          currentPlan()?.planned.includes(selection.id) === true
        ) {
          return;
        }

        state.takeOff(selection);
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
        const name = openView;

        if (name !== null && modified()) {
          promptView = name;
          unsavedDialog.show(
            name,
            CLEAR_BODY,
            (choice) => void chooseClear(name, choice),
          );

          return;
        }

        if (name !== null) {
          closeOpenView(name);

          return;
        }

        canvas.resetCamera();
        emptyCanvas();
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
        const next = walkFindings(
          groupsOf(allFindings).flatMap((group) => group.rows),
          orientedFinding,
          delta,
        );

        if (next !== null) {
          orientFinding(next);
        }
      },
      pickName,
      camera: () => renderBar(),
      measure,
      openTab,
    },
    scheduler,
    carried?.camera ?? null,
  );

  const describing = createDescribing();
  let responsibilityOf: (id: string) => ResponsibilityState =
    responsibilityStates(NO_FILES, null);

  async function readResponsibilities() {
    try {
      const files = await responsibilities.read();

      describedAt = files.responsibilitiesModifiedMs ?? null;
      responsibilityOf = responsibilityStates(
        files,
        await describerFallback(files.config),
      );
    } catch (error) {
      const reason = String(error);

      responsibilityOf = () => ({ kind: "unknown", reason });
    }

    describing.read(responsibilityOf);
    render();
  }

  async function describerFallback(
    config: string | null,
  ): Promise<EffectiveDescriber | null> {
    if (describerSeen === null || describerSeen.config !== config) {
      let found: EffectiveDescriber | null = null;

      try {
        const answer = await scanHost.port.describer();

        found =
          answer.status === "ok"
            ? { command: answer.command, version: answer.version }
            : null;
      } catch {
        found = null;
      }

      describerSeen = { config, found };
    }

    return describerSeen.found;
  }

  const rootActions: InspectorActions = {
    open() {
      inspectorOpen = true;
      render();
    },
    close() {
      inspectorOpen = false;
      hovered = null;
      resetList();
      const selected = state.selection();

      trail = startTrail(
        selected?.kind === "edge" ? trail.panels[0].selection : selected,
        inspectorTab,
      );
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
    addToView,
    moduleAbsent: (module) => !boxPresent(module),
    setFilter(text) {
      pickerFilter = text;
      render();
    },
    openInEditor: (target, line) =>
      void openInEditor(target, editor, fail, line),
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
        const reset = tab !== panel().tab ? { filter: "" } : {};

        trail = updatePanel(trail, index, { tab, ...reset });
        render();
      },
      toggleFold(key) {
        trail = updatePanel(trail, index, {
          folds: toggled(panel().folds, key),
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

  const unsavedDialog = buildUnsavedDialog();
  const deleting = new Set<string>();
  const bar = buildViewBar({
    back,
    forward,
    openView: (name) => void requestOpen(name),
    openViewsPanel: toggleViewsPanel,
    save: () => void saveOpen(),
    revert,
    saveNew: (name, title, description) => saveNew(name, title, description),
    saveDetails: (name, title, description) =>
      openView === null
        ? Promise.resolve(null)
        : saveDetails(openView, name, title, description),
    preview: (draft) => {
      headingDraft = draft;
      render();
    },
    copyLink: () => void copyLink(),
    hasOpenView: () => openView !== null,
  });
  const viewsPanel = buildViewsPanelView({
    open: (name) => void requestOpen(name),
    remove: (name) => void removeSavedView(name),
    saveDetails: (from, name, title, description) =>
      saveDetails(from, name, title, description),
  });
  const notesPanel = buildNotesPanelView({
    toggle: toggleNote,
    remove: (path) => removeNotePath(path),
    moveNote: (path, toIndex) =>
      reorderNotes(`reordered the notes`, (view) =>
        withNoteMoved(view, path, toIndex),
      ),
  });
  function applyTick(key: string, ticked: boolean) {
    const ticks = scanHost.ticks();

    if (key === DESCRIBE_KEY) {
      scanHost.setTicks({ ...ticks, describe: ticked });
      render();

      return;
    }

    const rows = rowSensors(scanConfig, shippedSensors);
    const plain = rows
      .filter(({ runsTests }) => !runsTests)
      .map(({ name }) => name);

    if (rows.some(({ name, runsTests }) => name === key && runsTests)) {
      const once = ticks.once.filter((one) => one !== key);

      scanHost.setTicks({ ...ticks, once: ticked ? [...once, key] : once });
      render();

      return;
    }

    const rest = (ticks.ticked ?? plain).filter((one) => one !== key);

    scanHost.setTicks({
      ...ticks,
      ticked: ticked ? [...rest, key] : rest,
    });
    render();
  }

  const scanView = buildScanPanelView({
    tick: applyTick,
    setOnlyView(on) {
      scanHost.setTicks({ ...scanHost.ticks(), onlyView: on });
      render();
    },
    setMode(next) {
      resultsMode = next;
      render();
    },
    run() {
      const { planned, button } = scanModel();

      if (planned === null || button.disabled) {
        return;
      }

      startRun(planned);
    },
    stop: () => scanHost.stop(),
    answerDescribe: (describe) => scanHost.answerDescribe(describe),
    clearReport: (name) => void clearReport(name),
    copy: (text) =>
      void views.copy(text).catch((error: unknown) => fail(String(error))),
    openLog: () =>
      void editor
        .openFile(SENSOR_LOG)
        .catch((error: unknown) => fail(String(error))),
  });
  const findingsView = buildFindingsPanelView({
    toggle: toggleFinding,
    addToView,
    toggleGroup(key) {
      if (!openGroups.delete(key)) {
        openGroups.add(key);
      }

      render();
    },
    openSensors() {
      leftPanel = "scan";
      render();
      void loadScanConfig();
    },
    setOnlyThisView(on) {
      findingsOnlyView = on;
      render();
    },
  });
  const rail = buildRailView({
    toggleFiles: toggleTree,
    toggleViews: toggleViewsPanel,
    toggleNotes: openNotes,
    toggleScan: toggleScanPanel,
    toggleFindings: toggleFindingsPanel,
  });
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

  canvas.element.append(bar.element);
  tree.element.append(
    viewsPanel.element,
    notesPanel.element,
    scanView.element,
    findingsView.element,
  );
  body.append(
    rail.element,
    tree.element,
    canvas.element,
    inspector.element,
    unsavedDialog.element,
  );
  container.replaceChildren(body);

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
      const row = flatRows(rows).find(
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
    if (selection?.kind === "edge") {
      return;
    }

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
    const plan = currentPlan();

    graph = buildCanvasGraph({
      scans,
      modules: [...loaded.modules, ...(plan?.planned ?? [])],
      opened: [...modules.opened(), ...(plan?.planned ?? [])],
      ghosts: plan?.ghosts ?? [],
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
    layout.request(
      toElk(
        graph,
        measure,
        notedBoxes(),
        barRowCounts(),
        sourcedBoxes(),
        changedBoxes(),
      ),
    );
    render();
  }

  function currentPlan(): PlanOverlay | null {
    const view = openViewValue();

    if (view === null || view.plan !== true) {
      return null;
    }

    if (
      planCache !== null &&
      planCache.view === view &&
      planCache.scans === scans
    ) {
      return planCache.value;
    }

    const value = planOverlay(view, resolveView(view, scans), scans);

    planCache = { view, scans, value };

    return value;
  }

  function currentMembers(): InspectorMembers | undefined {
    const plan = currentPlan();

    if (plan !== null) {
      return {
        mark: (module, key) =>
          plan.members.get(module)?.find((entry) => entry.member === key)
            ?.kind ?? null,
        planned: (module) =>
          (plan.members.get(module) ?? [])
            .filter((entry) => !entry.inScan)
            .map((entry) => entry.member),
        start: () => null,
        note: () => null,
      };
    }

    const info = changeInfo;

    if (info === null || info.state !== "ok" || info.name !== openView) {
      return undefined;
    }

    const found = info.members;
    const modifiedHere = (module: string) =>
      info.marked.some((one) => one.id === module && one.mark === "modified");

    return {
      mark: (module, key) =>
        found === null || found === "loading"
          ? null
          : (found.marks.get(module)?.get(key) ?? null),
      planned: () => [],
      start: (module) => {
        if (found === null || found === "loading") {
          return null;
        }

        for (const scan of found.start) {
          const entry = scan.modules.find((one) => one.id === module);

          if (entry !== undefined) {
            return entry.members ?? null;
          }
        }

        return null;
      },
      note: (module) => {
        if (!modifiedHere(module)) {
          return null;
        }

        if (found === "loading") {
          return "Member marks loading";
        }

        return found === null || found.marks.get(module) === null
          ? `Member marks need a scan of ${info.headCommit.slice(0, 7)}`
          : null;
      },
    };
  }

  function notedBoxes(): ReadonlySet<string> {
    const view = openViewValue();

    return view === null ? new Set<string>() : notedPaths(view);
  }

  function notedKey(): string {
    const rows = [...barRowCounts()]
      .filter(([, count]) => count > 0)
      .map(([id, count]) => `${id}:${count}`)
      .sort()
      .join("\n");

    return `${rows}|${[...notedBoxes()].sort().join("\n")}|${[...changedBoxes()].sort().join("\n")}`;
  }

  function changedBoxes(): ReadonlySet<string> {
    return new Set(
      graph.boxes
        .filter(
          (box) =>
            box.kind !== "folder" && currentFreshness().isChanged(box.id),
        )
        .map((box) => box.id),
    );
  }

  function currentFreshness(): FreshnessModel {
    freshnessCache ??= scanModel().freshness;

    return freshnessCache;
  }

  function currentOverlays(): OverlayModel {
    overlaysCache ??= applyFreshness(overlayModel, currentFreshness());

    return overlaysCache;
  }

  function foundBars(id: string) {
    if (currentFreshness().isChanged(id)) {
      return [];
    }

    return tickedMetrics().flatMap((metric) => {
      const value = moduleValue(metric, id);

      return value === null
        ? []
        : [{ label: shortMetric(metric), member: value.member }];
    });
  }

  function barRowCounts(): ReadonlyMap<string, number> {
    const counts = new Map<string, number>();

    for (const box of graph.boxes) {
      if (box.kind === "folder") {
        continue;
      }

      const found = foundBars(box.id);

      counts.set(
        box.id,
        found.length + (memberSources(found) === null ? 0 : 1),
      );
    }

    return counts;
  }

  function sourcedBoxes(): ReadonlySet<string> {
    return new Set(
      graph.boxes
        .filter(
          (box) =>
            box.kind !== "folder" && memberSources(foundBars(box.id)) !== null,
        )
        .map((box) => box.id),
    );
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

    if (selection?.kind !== "edge") {
      trail = startTrail(selection, inspectorTab);
    }

    hovered = null;
    reveal(selection);
    render();
    record();
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

    const wasOpen = name === openView;

    deleting.add(name);

    try {
      await views.remove(name);

      if (name === openView) {
        closeOpenView(name);
      }
    } catch (error) {
      fail(`Could not delete ${name}: ${String(error)}`);

      return;
    } finally {
      deleting.delete(name);
    }

    showUndo(name, text, wasOpen);
    await loadViewList();
    render();
  }

  function showUndo(name: string, text: string, reopen = false) {
    let id: number | null = null;
    let used = false;

    id = post({
      kind: "done",
      text: `Deleted ${name}`,
      action: {
        label: "Undo",
        run() {
          if (used) {
            return;
          }

          used = true;

          if (id !== null) {
            withdraw(id);
            deletionUndos.delete(id);
          }

          void views
            .write(name, text)
            .then(() => loadViewList())
            .then(async () => {
              if (reopen && openView === null && modules.count() === 0) {
                await openSaved(name);
              }
            })
            .then(() => render())
            .catch((error) =>
              fail(`Could not restore ${name}: ${String(error)}`),
            );
        },
      },
    });

    if (id !== null) {
      deletionUndos.add(id);
    }
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

    const anyModified = found.modules.some(
      (one) => one.mark === "modified" && one.box === "current",
    );
    const okInfo = {
      name,
      range,
      state: "ok" as const,
      marked: found.modules,
      unmatched: found.unmatched,
      at: Date.now(),
      headCommit: answer.headCommit,
    };

    changeInfo = { ...okInfo, members: anyModified ? "loading" : null };
    rebuild();
    render();

    if (!anyModified) {
      return;
    }

    const fetched = await views
      .rangeMembers(view.change.base, view.change.head)
      .catch(() => null);

    if (token !== openToken) {
      return;
    }

    changeInfo = {
      ...okInfo,
      members:
        fetched === null
          ? null
          : {
              marks: memberMarks({
                modules: found.modules,
                headCommit: answer.headCommit,
                current: scans as unknown as Parameters<
                  typeof memberMarks
                >[0]["current"],
                base: fetched.baseScans,
                files: fetched.files,
              }),
              start: fetched.baseScans,
            },
    };
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

  function orientFinding(id: string) {
    const row = allFindings.find((one) => one.id === id);

    if (row === undefined) {
      return;
    }

    const group = groupsOf(allFindings).find((one) =>
      one.rows.some((inner) => inner.id === id),
    );

    if (group !== undefined) {
      openGroups.add(group.key);
    }

    orientedFinding = id;
    render();
  }

  function boxPresent(module: string): boolean {
    const box = boxFor(module);

    return graph.boxes.some((one) => one.id === box);
  }

  function addToView(module: string) {
    if (!modules.isOpen(module)) {
      modules.open(module);
      changed();
    }
  }

  function syncOrientation(): CanvasOrientation | null {
    const row = allFindings.find((one) => one.id === orientedFinding);

    if (row === undefined) {
      orientedFinding = null;
      canvasOrientation = null;
      canvasOrientationKey = "";

      return null;
    }

    if (scene === null) {
      return null;
    }

    const boxIds = new Set(scene.boxes.map((box) => box.id));
    const lines = scene.lines.map((line) => line.id);
    const lit = litSet(row.record, boxFor, lines, boxIds);
    const key = JSON.stringify([row.id, [...lit].sort()]);

    if (key !== canvasOrientationKey || canvasOrientation === null) {
      canvasOrientationKey = key;
      canvasOrientation = { lit, tone: row.severity };
    }

    return canvasOrientation;
  }

  function showScanPanel() {
    leftPanel = "scan";
    render();
    void loadScanConfig();
  }

  function bringCanvasUpToDate() {
    const { planned, button } = scanModel(true);

    if (planned === null || button.disabled) {
      return;
    }

    startRun(planned);
  }

  function bringFindingsUpToDate() {
    const { planned, button } = scanModel(findingsOnlyView);

    if (planned === null || button.disabled) {
      return;
    }

    startRun(planned);
  }

  function startRun(planned: PlannedRun) {
    runPlanned = planned;
    scanHost.run(planned.plan.modules, planned);
  }

  function toggleScanPanel() {
    leftPanel = leftPanel === "scan" ? null : "scan";
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

    try {
      shippedSensors = await scanHost.port.shipped();
    } catch (error) {
      shippedSensors = { status: "unavailable", reason: String(error) };
    }

    overlayModel = buildOverlayModel(loaded.overlays ?? [], {
      sensors: loaded.sensors,
      shipped: shippedSensors,
    });

    overlaysCache = null;

    postConditions();
    render();
  }

  async function clearReport(name: string) {
    try {
      await scanHost.port.removeFindings([name]);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }

    scanHost.refresh();
    await loadScanConfig();
  }

  function scanModel(onlyView?: boolean) {
    const ticks = scanHost.ticks();

    return scanPanel({
      scan: scanHost.scan(),
      config: scanConfig,
      sensors: loaded.sensors,
      lines: { modules: loaded.modules, of: responsibilityOf },
      describedAt,
      ticks:
        onlyView === undefined
          ? {
              ...ticks,
              onlyView: ticks.onlyView && modules.opened().length > 0,
            }
          : { ...ticks, onlyView, describe: false },
      view: { name: openView, modules: modules.opened() },
      mode: onlyView === undefined ? resultsMode : "bring",
      scans,
      run: scanHost.runState(),
      scanning: scanHost.running(),
      progressText: scanHost.progressText(),
      sensorProgress: scanHost.sensorProgress?.() ?? null,
      extracting: scanHost.extracting?.() ?? false,
      runModules: runPlanned?.modules ?? 0,
      describeProgress: scanHost.describeProgress(),
      describeStop: scanHost.describeStop(),
      describeAsk: scanHost.describeAsk(),
      describeSkipped: scanHost.describeSkipped(),
      now: Date.now(),
      shipped: shippedSensors,
      freshness: freshnessOf(loaded),
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

    if (view === null || openView !== name) {
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

    canvas.walkTo(path, { animate });

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
      planned:
        selection.kind === "module" &&
        currentPlan()?.planned.includes(selection.id) === true,
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
    openView =
      snap.view !== null && viewList.some((entry) => entry.name === snap.view)
        ? snap.view
        : null;
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

      if (listNotice !== null) {
        heldViewKeys.add("view-list");
        post({ kind: "error", text: listNotice, key: "view-list" });
      } else if (heldViewKeys.delete("view-list")) {
        listKnown = true;
        postConditions();
      }

      listKnown = true;
      listProblem = null;
      setViewList(listing.views);
      void loadRecent();

      if (leftPanel === "views") {
        void refreshFacts();
      }
    } catch (error) {
      listNotice = `Could not list saved views: ${String(error)}`;
      heldViewKeys.add("view-list");
      post({ kind: "error", text: listNotice, key: "view-list" });
      listProblem = String(error);
      listKnown = false;
      renderBar();
    }
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

  function modified(): boolean {
    const text =
      openView === null
        ? undefined
        : viewList.find((entry) => entry.name === openView)?.text;
    const parsed = text === undefined ? null : parseViewFile(text);

    return parsed?.ok === true
      ? viewModified(parsed.view, canvasContent(), scans)
      : false;
  }

  let revertMessage: number | null = null;

  function emptyCanvas() {
    orientedFinding = null;
    noteFocus = null;
    state.clear();
  }

  function closeOpenView(name: string) {
    canvas.resetCamera();
    emptyCanvas();
    openView = null;
    changeInfo = null;
    headingDraft = null;
    pendingLanding = null;
    openToken += 1;
    comparisons.drop(name);

    if (revertMessage !== null) {
      withdraw(revertMessage);
      revertMessage = null;
    }

    rebuild();
    record();
    renderBar();
    render();
  }

  async function chooseClear(
    name: string,
    choice: "cancel" | "discard" | "save",
  ) {
    promptView = choice === "save" ? promptView : null;

    if (choice === "cancel") {
      unsavedDialog.hide();

      return;
    }

    if (choice === "save") {
      const written = await writeOpen();

      promptView = null;
      unsavedDialog.hide();

      if (!written || openView !== name) {
        return;
      }
    } else {
      unsavedDialog.hide();
    }

    closeOpenView(name);
    post({
      kind: "done",
      text:
        choice === "save"
          ? `Saved ${name} and closed it.`
          : `Closed ${name}. The saved view is unchanged.`,
    });
  }

  function revert() {
    const name = openView;
    const text =
      name === null ? undefined : viewList.find((e) => e.name === name)?.text;
    const parsed = text === undefined ? null : parseViewFile(text);

    if (name === null || parsed === null || !parsed.ok) {
      return;
    }

    if (!viewModified(parsed.view, canvasContent(), scans)) {
      canvas.setCamera("fit");
      renderBar();

      return;
    }

    const before = { ...canvasContent(), camera: canvas.camera() };
    const resolved = resolveView(parsed.view, scans);

    if (revertMessage !== null) {
      withdraw(revertMessage);
      revertMessage = null;
    }

    setCanvas(resolved.modules, resolved.folded, resolved.focus);
    canvas.setCamera("fit", endLayoutBusy !== null);
    revertMessage = post({
      kind: "done",
      text: `Reverted ${name} to its saved version.`,
      action: {
        label: "Undo",
        run() {
          if (openView !== name) {
            return;
          }

          setCanvas(before.modules, before.folded, before.focus);
          canvas.setCamera(before.camera, endLayoutBusy !== null);
        },
      },
    });
  }

  let promptView: string | null = null;

  function renderBar() {
    if (promptView !== null && (openView !== promptView || !modified())) {
      promptView = null;
      unsavedDialog.hide();
    }

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
          chip: parsed.ok ? rangeOf(parsed.view) : null,
        };
      }),
      names: viewList.map((entry) => entry.name),
      total: viewList.length,
      openChip: openChipOf(),
      openPlan: openViewValue()?.plan === true,
      canBack: history.canBack(),
      listed: listKnown,
      listProblem,
      canForward: history.canForward(),
      backLabel: backLabel(history.markNow()),
      forwardLabel: forwardLabel(history.markNext()),
      canCopy: openView !== null,
      canvasEmpty: modules.count() === 0,
      modified: modified(),
      canRevert: modified() || !canvas.fitted(),
      revertLabel: modified()
        ? "Revert to saved"
        : "Back to the saved position",
      openTitle: openViewValue()?.title ?? null,
      openDescription: openViewValue()?.description ?? null,
    });
  }

  function openChipOf(): string | null {
    const view = openViewValue();

    return view?.change === undefined ? null : rangeText(view.change);
  }

  function renamesFor(name: string, commit: string) {
    return comparisons.renames(name, commit, currentCommit(scans), () =>
      views.renamesSince(commit).catch(() => []),
    );
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
      heldViewKeys.add(`view-invalid:${name}`);
      post({
        kind: "error",
        text: viewNotice,
        key: `view-invalid:${name}`,
      });

      return;
    }

    const { view } = parsed;

    for (const warning of parsed.warnings) {
      post({ kind: "warning", text: `${name}: ${warning}` });
    }

    const token = ++openToken;
    const resolved = resolveView(view, scans);
    const missingPicks = resolved.unresolved.filter(
      (entry) => entry.kind === "pick",
    );
    const renames =
      withRenames && view.commit !== null && missingPicks.length > 0
        ? await renamesFor(name, view.commit)
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
    heldViewKeys.delete(`view-invalid:${name}`);
    viewTexts.set(name, text);
    openView = name;
    pendingLanding = landing && viewNotes(view).length > 0 ? name : null;
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
        ? await renamesFor(name, parsed.view.commit)
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
    view: Parameters<typeof staleReport>[0]["view"] & { title?: string },
    renames: { from: string; to: string }[],
    token: number,
  ) {
    const viewCommit = view.commit;
    const scanCommit = currentCommit(scans);

    if (viewCommit !== null && viewCommit === scanCommit) {
      return;
    }

    await comparisons.compare(
      {
        name,
        title: view.title ?? name,
        viewCommit,
        scanCommit,
        run: async () => {
          const before =
            viewCommit === null
              ? null
              : await views.scansAt(viewCommit).catch(() => null);

          return staleReport({ view, now: scans, before, renames });
        },
      },
      (message) => {
        post({
          kind: message.kind,
          text: message.text,
          key: message.key,
          ...(message.update
            ? {
                action: {
                  label: "Update" as const,
                  run: () => comparisons.requestUpdate(name),
                },
              }
            : {}),
        });
      },
    );

    if (token === openToken) {
      render();
    }
  }

  async function requestOpen(name: string, afterOpen?: () => Promise<void>) {
    const from = openView;

    if (from === null || name === from || !modified()) {
      await openSaved(name);
      await afterOpen?.();

      return;
    }

    promptView = from;
    unsavedDialog.show(
      from,
      `Opening ${name} closes ${from}. ${LOSS_WARNING}`,
      (choice) => void chooseOpen(from, name, choice, afterOpen),
    );
  }

  async function chooseOpen(
    from: string,
    name: string,
    choice: UnsavedChoice,
    afterOpen?: () => Promise<void>,
  ) {
    if (choice === "save") {
      const written = await writeOpen();

      promptView = null;
      unsavedDialog.hide();

      if (!written || openView !== from) {
        return;
      }

      post({ kind: "done", text: `Saved ${from}` });
    } else {
      promptView = null;
      unsavedDialog.hide();

      if (choice === "cancel") {
        return;
      }
    }

    await openSaved(name);
    await afterOpen?.();
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
      heldViewKeys.add(`view-invalid:${name}`);
      post({ kind: "error", text: problem, key: `view-invalid:${name}` });

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

  async function writeOpen(): Promise<boolean> {
    const name = openView;
    const text = name === null ? undefined : viewTexts.get(name);
    const parsed = text === undefined ? null : parseViewFile(text);

    if (name === null || parsed === null || !parsed.ok) {
      return false;
    }

    const clean = viewIsClean(name, parsed.view);

    return (
      (await writeView(name, {
        ...parsed.view,
        commit: clean ? currentCommit(scans) : parsed.view.commit,
        steps: stepsFor(parsed.view.steps, canvasContent(), scans),
      })) === null
    );
  }

  async function saveOpen() {
    const name = openView;

    if (await writeOpen()) {
      post({ kind: "done", text: `Saved ${name}` });
    }
  }

  async function saveDetails(
    from: string,
    name: string,
    title: string | null,
    description: string,
  ): Promise<string | null> {
    let current: string = from;

    if (name !== from) {
      const refused = await renameView(from, name);

      if (refused !== null) {
        return refused;
      }

      current = name;
    }

    const view = viewNamed(current);

    if (view === null) {
      return null;
    }

    const { title: _previous, ...rest } = view;
    const problem = await writeView(current, {
      ...rest,
      ...(title === null ? {} : { title }),
      description,
    });

    if (problem !== null) {
      return problem;
    }

    headingDraft = null;
    renderBar();
    render();
    post({ kind: "done", text: `Saved ${current}` });

    return null;
  }

  async function saveNew(name: string, title: string, description: string) {
    const trimmed = title.trim();
    const problem = await writeView(name, {
      schema_version: 4,
      ...(trimmed === "" ? {} : { title: trimmed }),
      description,
      commit: currentCommit(scans),
      steps: stepsFor([], canvasContent(), scans),
    });

    if (problem === null) {
      comparisons.drop(name);
      openView = name;
      record();
      noteOpened(name);
      renderBar();
      render();
      post({ kind: "done", text: `Saved ${name}` });
    }

    return problem;
  }

  async function renameView(from: string, to: string) {
    try {
      await views.rename(from, to);
    } catch (error) {
      return String(error);
    }

    const text = viewTexts.get(from);

    viewTexts.delete(from);
    comparisons.drop(from);
    postConditions();

    if (text !== undefined) {
      viewTexts.set(to, text);
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
    post({ kind: "done", text: `Renamed ${from} to ${to}` });

    return null;
  }

  async function copyLink() {
    if (openView === null) {
      return;
    }

    const link = await views.link(openView);

    await views.copy(link);
    post({ kind: "done", text: `Copied ${link}` });
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
      await requestOpen(resolved.open);
    } else {
      fail(resolved.refuse);
    }
  }

  function postConditions() {
    const found: string[] = [];
    const condition = (key: string, kind: MessageKind, text: string) => {
      found.push(key);
      post({ kind, text, key, onOpen: true });
    };

    for (const text of loaded.notices) {
      condition(
        `scan-file:${text}`,
        text.startsWith("recognizer scan exited") ? "error" : "warning",
        text,
      );
    }

    for (const text of health.notices) {
      condition(
        "baseline-unreadable",
        "warning",
        `The baseline cannot be read: ${text.replace(/^baseline: /, "")}`,
      );
    }

    for (const name of [
      ...(loaded.overlaysUnreadable ?? []),
      ...overlayModel.unreadable,
    ]) {
      condition(
        `overlay-unreadable:${name}`,
        "warning",
        `Overlay ${name} could not be read`,
      );
    }

    const freshness = freshnessMessage(scanModel(true).freshness);

    if (freshness !== null) {
      found.push(freshness.key);
      post({
        kind: "warning",
        text: freshness.text,
        key: freshness.key,
        action: {
          label: freshness.label,
          run: bringCanvasUpToDate,
        },
        extra: { label: "Show in Scan", run: showScanPanel },
      });
    }

    found.push(...heldViewKeys, ...comparisons.heldKeys(currentCommit(scans)));
    if (!listKnown) {
      found.push("view-list");
    }

    reconcileMessages(found);
  }

  function viewIsClean(name: string, view: View): boolean {
    const scanCommit = currentCommit(scans);

    if (view.commit !== null && view.commit === scanCommit) {
      return true;
    }

    const report = comparisons.settled(name, view.commit, scanCommit);

    return report !== null && !hasEntries(report);
  }

  async function update(name: string) {
    if (openView !== name) {
      await requestOpen(name, () => applyUpdate(name));

      return;
    }

    await applyUpdate(name);
  }

  async function applyUpdate(name: string) {
    const text = viewList.find((entry) => entry.name === name)?.text;
    const parsed = text === undefined ? null : parseViewFile(text);

    if (openView !== name || parsed === null || !parsed.ok) {
      return;
    }

    const { view } = parsed;
    const report = comparisons.settled(name, view.commit, currentCommit(scans));

    if (report === null) {
      return;
    }

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

    comparisons.drop(name);
    postConditions();
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

    if (entry === undefined && deleting.has(name)) {
      return;
    }

    if (entry === undefined) {
      openView = null;
      viewTexts.delete(name);
      comparisons.drop(name);
      postConditions();
      openToken += 1;
      viewNotice = `${name} was deleted from .recognizer/views`;
      post({ kind: "warning", text: viewNotice });
      record();
      render();

      return;
    }

    if (entry.text === viewTexts.get(name)) {
      return;
    }

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
            toElk(
              graph,
              measure,
              notedBoxes(),
              barRowCounts(),
              sourcedBoxes(),
              changedBoxes(),
            ),
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
    const bubbles = bubbleSet(view, positions, focus);
    const marks = view === null ? new Set<string>() : notedPaths(view);
    const keys = {
      notesOpen: leftPanel === "notes",
      noteActive: held !== null,
      findingsOpen: leftPanel === "findings",
      stepping: held !== null && focus?.editing === false,
    };
    const key = JSON.stringify([[...marks].sort(), focus, bubbles, keys]);

    if (key !== canvasNotesKey || canvasNotes === undefined) {
      canvasNotesKey = key;
      canvasNotes = {
        marks,
        active: focus?.path ?? null,
        bubbles,
        keys,
      };
    }

    return canvasNotes;
  }

  function tickedMetrics(): MetricDescriptor[] {
    return metricTicks.flatMap((key) =>
      currentOverlays().metrics.filter((metric) => metric.key === key),
    );
  }

  function canvasMetrics(): CanvasMetrics {
    const ticked = tickedMetrics();
    const now = Date.now();
    const rows = currentFreshness().rows;

    return {
      groups: currentOverlays().groups.map((group) => {
        const note = freshnessNote(
          group,
          rows.find((row) => row.key === group.name),
          now,
          shippedSensors,
        );

        return note === null
          ? group
          : { ...group, notes: [note, ...group.notes] };
      }),
      now,
      ticked,
      valueOf: (metric, boxId) =>
        currentFreshness().isChanged(boxId) ? null : moduleValue(metric, boxId),
    };
  }

  let lastHeading: Heading | null = null;
  let headingDraft: { title: string | null; description: string } | null = null;

  function headingNow(): Heading | null {
    const view = openViewValue();

    if (view === null) {
      lastHeading = null;

      return null;
    }

    const title =
      headingDraft === null ? (view.title ?? null) : headingDraft.title;
    const description =
      headingDraft === null ? view.description : headingDraft.description;

    if (
      lastHeading === null ||
      lastHeading.title !== title ||
      lastHeading.description !== description
    ) {
      lastHeading = { title, description };
    }

    return lastHeading;
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
      describe: (id) => descriptionOf(responsibilityOf(id)),
      open: modules.count(),
      total: modules.total(),
      showInferred: state.showInferred(),
      notice: layoutNotice,
      busy: layoutBusy,
      notes,
      orientation: syncOrientation(),
      metrics: canvasMetrics(),
      changes: changeOverlay(),
      changed: (id) => currentFreshness().isChanged(id),
      plan: currentPlan(),
      heading: headingNow(),
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

    freshnessCache = null;
    overlaysCache = null;

    const scanModelNow = scanModel();

    freshnessCache = scanModelNow.freshness;
    scanHost.footer?.(scanModelNow.freshness.footer);
    scanView.render(scanModelNow);
    viewsPanel.render(
      leftPanel === "views"
        ? viewsPanelModel(viewList, scans, viewFacts)
        : null,
      openView,
    );

    const scoped = findingsOnlyView;
    const shownFindings = scoped
      ? scopedRows(allFindings, scopeOf(modules.opened()))
      : allFindings;
    const groups = groupsOf(shownFindings);

    const findingsFresh = scanModel(scoped).freshness;
    const everyChanged =
      scoped &&
      modules.count() > 0 &&
      modules.opened().every((id) => findingsFresh.isChanged(id));
    const noneYet = (sensor: string) =>
      findingsFresh.group(sensor) === "none-yet";
    const shownGroups = everyChanged ? [] : withEmptyGroups(groups, noneYet);
    const hiddenIn = scoped
      ? scopedRows(hiddenRows, scopeOf(modules.opened()))
      : hiddenRows;
    const hiddenModules = new Set(hiddenIn.map((row) => row.module)).size;
    const findingsLine =
      findingsFresh.findings?.kind === "hidden" || hiddenModules === 0
        ? findingsFresh.findings
        : {
            kind: "hidden" as const,
            text: hiddenText(hiddenModules, !scoped),
            link: "Update them",
          };
    const primary = findingsFresh.action.primary;
    const findingsAction = findingsActionOf(primary, findingsLine?.link ?? "");

    findingsView.render({
      scope: {
        caption: scopeCaption(openView, modules.count()),
        on: findingsOnlyView,
      },
      header: headerLine(shownFindings),
      freshness:
        findingsLine === null
          ? null
          : {
              text: findingsLine.text,
              action: {
                label: findingsAction.label,
                run: findingsAction.openScan
                  ? showScanPanel
                  : bringFindingsUpToDate,
              },
            },
      noPolicy: loaded.policy === null,
      groups: shownGroups.map((group) => ({
        group,
        open: openGroups.has(group.key),
        cards: openGroups.has(group.key) ? group.rows.map(cardOf) : [],
        none:
          group.rows.length === 0 || noneYet(SENSOR_GROUPS[group.key] ?? ""),
      })),
      active: orientedFinding,
      absent: (module) => !boxPresent(module),
      empty: everyChanged
        ? "Every module on this canvas changed, so there is nothing current to show."
        : allFindings.length === 0
          ? "No findings for this scan."
          : shownFindings.length === 0
            ? "No findings on this canvas's modules."
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
      description: (id) => descriptionOf(responsibilityOf(id)),
      expanded,
      selected:
        selection === null || selection.kind === "edge" ? null : selection.id,
      isOpen: modules.isOpen,
      filter,
    });
    body.classList.toggle("inspector-open", inspectorOpen);
    renderCanvas();
    notesPanel.render({
      hasView: noteView !== null,
      rows: noteRowsNow(),
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
        counts: graph.counts,
        filter: root ? pickerFilter : panel.filter,
        followed: panel.followed,
        responsibility: (id) => ({
          state: responsibilityOf(id),
          failure: describing.failure(id),
        }),
        metrics: currentOverlays().metrics,
        metricsOn: tickedMetrics().length > 0,
        limits: limitsFromText(scanConfig),
        proposed: (id) => currentPlan()?.proposed.get(id) ?? null,
        members: currentMembers(),
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
      crumbs: crumbs(
        trail,
        compaction,
        (id) => described.get(id)?.disc ?? "grey",
      ),
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
      post({
        kind: "info",
        text: `Rescanned: ${gone} ${gone === 1 ? "module" : "modules"} on the canvas ${gone === 1 ? "is" : "are"} gone`,
      });
    }
  }

  postConditions();

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

  const stopUpdating = comparisons.onUpdate((name) => void update(name));
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
    void openInEditor(state.selection(), editor, fail);
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
    carry: () => ({
      history,
      snapshot: snapshot(),
      leftPanel,
      metricTicks,
      camera: canvas.camera(),
    }),
    update(next) {
      loaded = next;
      freshnessCache = null;
      overlaysCache = null;
      health = computeHealth(loaded);
      described = describeTree(root, health);
      overlayModel = buildOverlayModel(loaded.overlays ?? [], {
        sensors: loaded.sensors,
        shipped: shippedSensors,
      });
      allFindings = findingRows(health.documents);
      hiddenRows = findingRows(health.hidden);
      metricTicks = pruneTicks(metricTicks, overlayModel.metrics);
      postConditions();
      render();
    },
    dispose() {
      document.removeEventListener("keydown", onUndoKey);
      resizeObserver?.disconnect();
      stopWatching();
      stopUpdating();
      stopDriving();
      agentLine.clear();

      for (const id of deletionUndos) {
        withdraw(id);
      }

      deletionUndos.clear();
      stopWatchingResponsibilities();
      bar.dispose();
    },
  };
}
