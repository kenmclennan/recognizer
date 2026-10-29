import { resolveView } from "recognizer";
import { type Scheduler, timerScheduler } from "./bar-hover";
import {
  buildCanvasGraph,
  type CanvasGraph,
  edgesOf,
  neighbourhoodOf,
  presenceOf,
} from "./canvas-graph";
import { absoluteLayout, toElk } from "./canvas-layout";
import { type Scene, toScene } from "./canvas-scene";
import { createCanvasState, type Selection } from "./canvas-state";
import { buildCanvasView, createMeasure } from "./canvas-view";
import {
  type CurrentView,
  currentViewOf,
  latestWins,
  type Snapshot,
} from "./current-view";
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
  type Narrowed,
} from "./inspector-model";
import { buildInspectorView } from "./inspector-view";
import {
  createLayoutSource,
  layoutOnMainThread,
  startLayoutWorker,
} from "./layout-source";
import { buildCallerIndex } from "./member-callers";
import { createOpenModules } from "./open-modules";
import { buildRailView } from "./rail-view";
import { repositorySource } from "./repository-source";
import type { RowSpec } from "./row-view";
import type { Loaded } from "./scan-loading";
import type { BarModel } from "./selection-bar-view";
import { buildStalePanel, type StalePanelModel } from "./stale-panel-view";
import {
  currentCommit,
  hasEntries,
  type StaleReport,
  staleReport,
} from "./stale-report";
import { type FilterState, filterTree, isVisible } from "./tree-filter";
import { ancestorFolders, buildTree } from "./tree-model";
import { buildTreeView } from "./tree-view";
import { buildViewBar } from "./view-bar-view";
import { parseViewFile, serialiseView } from "./view-file";
import { createHistory, type History } from "./view-history";
import { stepsFor } from "./view-steps";
import { inertViews, type ViewsPort } from "./views-port";

export type Carried = {
  history: History<Snapshot>;
  snapshot: Snapshot;
};

export type Explorer = {
  toggleTree: () => void;
  carry: () => Carried;
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
  let pickerFilter = "";
  let narrowed: Narrowed | null = null;
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
  const writeCurrent = latestWins(views.writeCurrent);

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
      measure,
      openTab,
    },
    scheduler,
  );

  const inspector = buildInspectorView({
    open() {
      inspectorOpen = true;
      render();
    },
    close() {
      inspectorOpen = false;
      hovered = null;
      resetList();
      render();
    },
    setTab(tab) {
      if (tab !== inspectorTab) {
        resetFilter();
      }

      inspectorTab = tab;
      narrowed = null;
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
      resetFilter();
      inspectorOpen = true;
      inspectorTab = "dependencies";
      narrowed = {
        title: button.pickerTitle,
        items: button.callers.map((id) => ({ id, names: [button.name] })),
      };
      render();
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
  const rail = buildRailView({ toggleFiles: toggleTree });
  const notices = el("div", "notices");

  notices.setAttribute("role", "status");

  const body = el("div", "explorer");

  canvas.element.append(bar.element, stale.element);
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
    narrowed = null;
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
    narrowed = null;
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
    const previous = state.selection();

    if (previous?.kind !== selection?.kind || previous?.id !== selection?.id) {
      resetList();
    }

    state.select(selection);
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

  function persist(snap: Snapshot) {
    const current: CurrentView = currentViewOf(snap);

    writeCurrent(`${JSON.stringify(current, null, 2)}\n`);
  }

  function record() {
    const snap = snapshot();

    history.record(snap);
    persist(snap);
    renderBar();
  }

  function canvasContent() {
    return {
      modules: modules.opened(),
      folded: [...state.folded()],
      focus: state.focus(),
    };
  }

  function setCanvas(ids: string[], folded: string[], focus: string | null) {
    for (const id of modules.opened()) {
      modules.close(id);
    }

    for (const id of ids) {
      modules.open(id);
    }

    state.restore(folded, focus);
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

    for (const id of modules.opened()) {
      modules.close(id);
    }

    for (const id of snap.modules) {
      modules.open(id);
    }

    state.restore(snap.folded, snap.focus);
    openView = snap.view;
    evidence = null;
    hovered = null;
    resetList();
    rebuild();
    state.select(snap.selection);
    state.reconcile(presenceOf(graph));
    reveal(state.selection());
    render();
    persist(snap);
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
      schema_version: 1,
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
    persist(snapshot());
    render();
    notify(`Renamed ${from} to ${to}`);

    return null;
  }

  async function copyLink() {
    if (openView === null) {
      return;
    }

    const path = await views.path(openView);

    await views.copy(path);
    notify(`Copied ${path}`);
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

  function renderCanvas() {
    onCount(`${modules.count()} of ${modules.total()} modules on the canvas`);

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
      showInferred: state.showInferred(),
      notice: layoutNotice,
    });
  }

  function render() {
    const filtered = filterTree(root, filter, context);
    const selection = state.selection();

    body.classList.toggle("tree-hidden", treeHidden);
    rail.render(!treeHidden);
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
        counts: graph.counts,
        filter: pickerFilter,
        collapsed: groupFlips,
        narrowed,
      }),
      inspectorOpen,
    );

    if (scrollTarget !== null) {
      tree.scrollTo(scrollTarget);
      scrollTarget = null;
    }
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

    state.restore(
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
      state.select(selection);
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

  const stopWatching = views.onChanged(() => void onViewsChanged());

  void loadViewList().then(() => {
    if (carried?.snapshot.view != null) {
      void recompare(carried.snapshot.view);
    }
  });

  return {
    toggleTree,
    carry: () => ({ history, snapshot: snapshot() }),
    dispose() {
      stopWatching();
      bar.dispose();
    },
  };
}
