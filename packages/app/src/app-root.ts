import { createAwakeClock } from "recognizer";
import { createBusyGate } from "./busy-gate";
import { editorSource } from "./editor-source";
import type { Carried, Explorer, ScanHost } from "./explorer";
import { NO_CHANGES, type ScanOrigin, type ScanState } from "./footer-scan";
import type { FooterView } from "./footer-view";
import { settledMessage } from "./holding-settled";
import type { HoldingView } from "./holding-view";
import { repositorySource } from "./repository-source";
import { createRepositoryStateHolder } from "./repository-state-holder";
import { ranAtOf } from "./repository-state-model";
import { repositoryStateSource } from "./repository-state-source";
import { createRescanner } from "./rescanner";
import { refreshOnChange } from "./revision-refresh";
import { runLogPath } from "./run-log-path";
import { createChangesHandler } from "./scan-changes";
import { OPEN_RUN } from "./scan-freshness";
import { type Loaded, loadScans } from "./scan-loading";
import { openProgressModel, STOPPED_MODEL } from "./scan-open-model";
import type { OpenActions, OpenView } from "./scan-open-view";
import { describerRegistered, rowSensors } from "./scan-panel-model";
import { scanSource, setScanRepository } from "./scan-source";
import { withSensors } from "./sensor-run";
import { createSensorsSource } from "./sensors-source";
import { settingsModalSource } from "./settings-modal-source";
import type { SettingsModal, SettingsModalDeps } from "./settings-modal-view";
import type { SetupModal, SetupModalDeps } from "./setup-modal-view";
import { doctorProblems } from "./setup-model";
import type { DoctorRead } from "./setup-port";
import { setupSource } from "./setup-source";
import { singleFlight } from "./single-flight";
import {
  createViewComparisons,
  type ViewComparisons,
} from "./view-comparisons";

export type ExplorerRequest = {
  loaded: Loaded;
  folderName: string;
  carried: Carried | null;
  scanHost: ScanHost;
  comparisons: ViewComparisons;
  openSettings: () => void;
  openSetup: () => void;
  onKeys: (keys: readonly string[]) => void;
};

export interface AppView {
  readonly footer: FooterView;
  clear(): void;
  showEmpty(choose: () => void): void;
  showMessage(text: string, isError?: boolean): void;
  showHolding(stop: () => void, line: string | null): HoldingView;
  showOpen(actions: OpenActions): OpenView;
  showExplorer(request: ExplorerRequest): Explorer;
  openSettings(deps: SettingsModalDeps): SettingsModal;
  openSetup(deps: SetupModalDeps): SetupModal;
}

export type App = {
  started: Promise<void>;
  toggleTree: () => void;
  refreshResponsibilities: () => void;
  openSelectedInEditor: () => void;
  openLinkedView: () => void;
  openSettings: () => void;
};

export function composeApp(view: AppView): App {
  const footerView = view.footer;

  let explorer: Explorer | null = null;
  let folderName = "";
  let scanState: ScanState | null = null;
  let runningLine: string | null = null;
  let current: Loaded | null = null;
  let releaseFirstScan: () => void = () => {};
  let holding: HoldingView | null = null;
  let openView: OpenView | null = null;
  let openStartedAt = 0;
  let openTick: ReturnType<typeof setInterval> | null = null;
  let explorerKeys: readonly string[] = [];
  let repositoryOpen = false;
  let settingsModal: SettingsModal | null = null;
  let setupModal: SetupModal | null = null;
  let setupProblems: number | null = null;

  function openSettings(): void {
    if (settingsModal !== null) {
      return;
    }

    settingsModal = view.openSettings({
      port: settingsModalSource,
      sensors: sensorsSource,
      repository: repositoryOpen,
      onClose: () => {
        settingsModal = null;
      },
    });
  }

  function noteDoctor(read: DoctorRead): void {
    setupProblems = doctorProblems(read);
    explorer?.setSetupProblems(setupProblems);
  }

  const refreshDoctor = singleFlight(runDoctor);

  function runDoctor(): Promise<unknown> {
    if (!repositoryOpen) {
      return Promise.resolve();
    }

    return setupSource
      .survey(false, () => {})
      .then((read) =>
        noteDoctor(
          read.status === "ok"
            ? read.doctor
            : { status: "unavailable", reason: read.reason },
        ),
      )
      .catch((error: unknown) =>
        noteDoctor({ status: "unavailable", reason: String(error) }),
      );
  }

  function openSetup(): void {
    if (setupModal !== null || !repositoryOpen) {
      return;
    }

    setupModal = view.openSetup({
      port: setupSource,
      reloadSensors: async () => {
        await rescanner.refresh();
      },
      scanAfterApply: () => void rescanner.run(null, OPEN_RUN),
      onDoctor: noteDoctor,
      onClose: () => {
        setupModal = null;
      },
    });
  }

  const repositoryState = createRepositoryStateHolder(repositoryStateSource);
  const sensorsSource = createSensorsSource({
    state: repositoryState,
    results: repositoryStateSource,
  });

  const sensed = (loaded: Loaded) => withSensors(loaded, sensorsSource);

  function setScanState(next: ScanState | null) {
    scanState = next;

    if (next === null) {
      footerView.setScan(null);
    }
  }

  function adoptedOrigin(origin: ScanOrigin) {
    setScanState({
      origin,
      scannedAt: Date.now(),
      changes: NO_CHANGES,
      scanning: runningLine,
    });
  }

  const scanHost: ScanHost = {
    port: sensorsSource,
    plan: (request) => scanSource.plan(request),
    estimate: (request) => scanSource.estimate(request),
    scan: () =>
      scanState === null
        ? null
        : {
            ...scanState,
            scannedAt: ranAtOf(scanState.scannedAt, repositoryState.current()),
          },
    ticks: () => rescanner.ticks(),
    setTicks: (next) => rescanner.setTicks(next),
    changeTicks: (ticks, changes) => scanSource.changeTicks(ticks, changes),
    runState: () => rescanner.runState(),
    running: () => rescanner.running(),
    external: () => rescanner.external(),
    progressText: () => runningLine,
    footer: (text) => footerView.setScan(text),
    sensorProgress: () => rescanner.progress().sensorProgress,
    extracting: () => rescanner.progress().extract === "run",
    describeProgress: () => {
      const describe = rescanner.progress().describe;

      return describe === null
        ? null
        : { entries: describe.entries.length, total: describe.total };
    },
    describeStop: () => rescanner.progress().describeStop,
    describeAsk: () => rescanner.progress().describeAsk,
    describeSkipped: () => rescanner.progress().describeSkipped,
    runView: () => rescanner.runView(),
    answerDescribe: (describe) => void rescanner.answerDescribe(describe),
    run: (modules, planned) => void rescanner.run(modules, planned),
    stop: () => void rescanner.stop(),
    refresh: () => void rescanner.refresh(),
  };

  const comparisons = createViewComparisons();

  function buildExplorer(loaded: Loaded, carried: Carried | null): Explorer {
    current = loaded;

    return view.showExplorer({
      loaded,
      folderName,
      carried,
      scanHost,
      comparisons,
      openSettings,
      openSetup,
      onKeys: (keys) => {
        explorerKeys = keys;
        reconcileKeys();
      },
    });
  }

  function reconcileKeys() {
    footerView.reconcile(explorerKeys);
  }

  function openLogFile(path: string) {
    void editorSource
      .openFile(path)
      .catch((error: unknown) =>
        footerView.post({ kind: "error", text: String(error) }),
      );
  }

  const awakeClock = createAwakeClock<number>({
    read: () => performance.now(),
    setTimer: (fn, ms) => globalThis.setTimeout(fn, ms) as unknown as number,
    clearTimer: (timer) => globalThis.clearTimeout(timer),
  });

  awakeClock.start();

  const rescanner = createRescanner<Carried>({
    awake: () => awakeClock.now(),
    port: scanSource,
    snapshot: {
      run: () => repositoryState.current()?.run ?? null,
      onRun: (handler) =>
        repositoryState.onRevision((state) => handler(state.run)),
    },
    registered: async () => {
      const { config } = await sensorsSource.inputs();
      const installed = await sensorsSource
        .sensorList()
        .catch(() => ({ status: "unavailable" as const, reason: "" }));

      return {
        sensors: rowSensors(config, installed),
        describerRegistered: describerRegistered(config),
      };
    },
    load: loadScans,
    sense: sensed,
    resense: async () => (current === null ? null : sensed(current)),
    adopt: () => repositorySource.adoptScan(),
    carry: () => explorer?.carry() ?? null,
    replace: (loaded, carried) => {
      explorer?.dispose();
      explorer = buildExplorer(loaded, carried);
      explorer.setSetupProblems(setupProblems);
    },
    update: (loaded) => {
      if (explorer === null) {
        return false;
      }

      current = loaded;
      explorer.update(loaded);

      return true;
    },
    adopted: adoptedOrigin,
    describedLine: () => explorer?.refreshResponsibilities(),
    progress: (update) => {
      runningLine = update.scanning;
      holding?.update(update.scanning);
      renderOpenProgress();

      if (scanState !== null) {
        setScanState({ ...scanState, scanning: runningLine });
      }

      explorer?.refreshPanel();
    },
    attached: () => {
      holding = view.showHolding(() => void rescanner.stop(), runningLine);
    },
    settled: () => {
      const message = settledMessage(holding !== null, explorer !== null);

      if (message !== null) {
        view.showMessage(message);
      }

      holding = null;
      releaseFirstScan();
      releaseFirstScan = () => {};
      refreshDoctor();
    },
    hasExplorer: () => explorer !== null,
    blocked: (text) => {
      if (explorer === null) {
        view.showMessage(text, true);
      } else {
        footerView.post({
          kind: "error",
          text: `The recognizer scan exited non-zero: ${text}`,
        });
      }
    },
    post: (input) => footerView.post(input),
    attach: (id, extra) => footerView.attach(id, extra),
    show: (target) => explorer?.show(target),
    openLog: openLogFile,
  });

  const openActions: OpenActions = {
    stop: () => void rescanner.stop(),
    again: () => void start(),
    openLog: () => {
      const log = rescanner.progress().log;

      if (log !== null) {
        openLogFile(runLogPath(log));
      }
    },
  };

  function renderOpenProgress() {
    openView?.render(
      openProgressModel({
        folder: folderName,
        progress: rescanner.progress(),
        startedAt: openStartedAt,
        now: awakeClock.now(),
        stopped: false,
      }),
    );
  }

  function showOpenProgress() {
    if (holding !== null) {
      return;
    }

    openView = view.showOpen(openActions);
    renderOpenProgress();
    openTick = globalThis.setInterval(renderOpenProgress, 1000);
  }

  function hideOpenProgress() {
    if (openTick !== null) {
      globalThis.clearInterval(openTick);
      openTick = null;
    }

    openView?.remove();
    openView = null;
  }

  function showOpenStopped() {
    openView = view.showOpen(openActions);
    openView.render(STOPPED_MODEL);
  }

  async function start(): Promise<void> {
    await rescanner.stop();
    explorer?.dispose();
    explorer = null;
    current = null;
    runningLine = null;
    holding = null;
    setupProblems = null;
    setScanState(null);
    footerView.setCount("");

    const folder = await repositorySource.windowFolder();

    repositoryOpen = folder !== null;

    if (folder === null) {
      view.showEmpty(() => {
        void repositorySource.chooseFolder().catch((error: unknown) => {
          footerView.post({ kind: "error", text: String(error) });
        });
      });

      return;
    }

    setScanRepository(folder);
    void scanSource.watchExternal().catch((error: unknown) => {
      footerView.post({ kind: "error", text: String(error) });
    });
    void repositoryState.start().catch(() => {});
    folderName = folder.split(/[\\/]/).filter(Boolean).pop() ?? folder;
    view.clear();

    const firstSettled = new Promise<void>((resolve) => {
      releaseFirstScan = resolve;
    });

    openStartedAt = awakeClock.now();
    void rescanner.run(null, OPEN_RUN);

    await createBusyGate(showOpenProgress, hideOpenProgress).run(firstSettled);

    if (explorer === null) {
      if (rescanner.progress().stopped) {
        showOpenStopped();
      }

      return;
    }

    (explorer as Explorer).openLinkedView();
    await repositorySource.watchChanges();
  }

  refreshOnChange(repositoryState, async () => {
    await rescanner.refresh();
    await explorer?.reloadSensors();
  });

  repositoryState.onInputsChange(() => {
    void rescanner
      .refresh()
      .catch(() => {})
      .then(refreshDoctor);
  });

  void repositorySource.onRescan(() => void rescanner.run());

  void repositorySource.onOpenSettings(openSettings);

  void repositorySource.onChanges(
    createChangesHandler({
      state: () => scanState,
      setState: setScanState,
      refreshPanel: () => explorer?.refreshPanel(),
    }),
  );

  void repositorySource.onFolderAssigned(() => void start());

  const started = start().catch((error: unknown) =>
    view.showMessage(String(error), true),
  );

  return {
    started,
    toggleTree: () => explorer?.toggleTree(),
    refreshResponsibilities: () => explorer?.refreshResponsibilities(),
    openSelectedInEditor: () => explorer?.openSelectedInEditor(),
    openLinkedView: () => explorer?.openLinkedView(),
    openSettings,
  };
}
