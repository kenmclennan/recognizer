import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import "./style.css";
import { createAwakeClock } from "recognizer";
import { createBusyGate } from "./busy-gate";
import { commitsSource } from "./commits-source";
import { editorSource } from "./editor-source";
import { showEmpty } from "./empty-view";
import {
  type Carried,
  type Explorer,
  type ScanHost,
  showExplorer,
} from "./explorer";
import { NO_CHANGES, type ScanOrigin, type ScanState } from "./footer-scan";
import { buildFooter } from "./footer-view";
import { settledMessage } from "./holding-settled";
import { type HoldingView, showHolding } from "./holding-view";
import { inputsRefresh, singleFlight } from "./inputs-refresh";
import { showMessage } from "./message-view";
import { repositorySource } from "./repository-source";
import { createRescanner } from "./rescanner";
import { responsibilitiesSource } from "./responsibilities-source";
import { runLogPath } from "./run-log-path";
import { createChangesHandler } from "./scan-changes";
import { OPEN_RUN } from "./scan-freshness";
import { type Loaded, loadScans } from "./scan-loading";
import { openProgressModel, STOPPED_MODEL } from "./scan-open-model";
import { type OpenView, showOpen } from "./scan-open-view";
import { describerRegistered, rowSensors } from "./scan-panel-model";
import { scanSource, setScanRepository } from "./scan-source";
import { withSensors } from "./sensor-run";
import { sensorsSource } from "./sensors-source";
import { settingsModalSource } from "./settings-modal-source";
import { openSettingsModal, type SettingsModal } from "./settings-modal-view";
import { openSetupModal, type SetupModal } from "./setup-modal-view";
import { doctorProblems } from "./setup-model";
import type { DoctorRead } from "./setup-port";
import { setupSource } from "./setup-source";
import { createViewComparisons } from "./view-comparisons";
import { viewsSource } from "./views-source";
import { createVisualisationSource } from "./visualisation-source";
import { windowSource } from "./window-source";

const content = document.getElementById("content") as HTMLElement;
const footer = document.getElementById("footer") as HTMLElement;

const footerView = buildFooter(footer);

let explorer: Explorer | null = null;
let folderName = "";
let scanState: ScanState | null = null;
let runningLine: string | null = null;
let current: Loaded | null = null;
let releaseFirstScan: () => void = () => {};
let holding: HoldingView | null = null;
let openView: OpenView | null = null;
let openStartedAt = 0;
let openTick: number | null = null;
let explorerKeys: readonly string[] = [];
let repositoryOpen = false;
let settingsModal: SettingsModal | null = null;

function openSettings(): void {
  if (settingsModal !== null) {
    return;
  }

  settingsModal = openSettingsModal({
    port: settingsModalSource,
    sensors: sensorsSource,
    repository: repositoryOpen,
    onClose: () => {
      settingsModal = null;
    },
  });
}

let setupModal: SetupModal | null = null;
let setupProblems: number | null = null;

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

  setupModal = openSetupModal({
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
  scan: () => scanState,
  ticks: () => rescanner.ticks(),
  setTicks: (next) => rescanner.setTicks(next),
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

  return showExplorer(
    content,
    loaded,
    folderName,
    (text) => footerView.setCount(text),
    viewsSource,
    (input) => footerView.post(input),
    carried,
    undefined,
    localStorage,
    editorSource,
    responsibilitiesSource,
    windowSource,
    scanHost,
    (id) => footerView.withdraw(id),
    (keys) => {
      explorerKeys = keys;
      reconcileKeys();
    },
    comparisons,
    commitsSource,
    openSettings,
    openSetup,
    undefined,
    createVisualisationSource(),
  );
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
  setTimer: (fn, ms) => window.setTimeout(fn, ms),
  clearTimer: (timer) => window.clearTimeout(timer),
});

awakeClock.start();

const rescanner = createRescanner<Carried>({
  awake: () => awakeClock.now(),
  port: scanSource,
  registered: async () => {
    const { config } = await sensorsSource.readInputs();
    const shipped = await sensorsSource
      .shipped()
      .catch(() => ({ status: "unavailable" as const, reason: "" }));

    return {
      sensors: rowSensors(config, shipped),
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
    holding = showHolding(content, () => void rescanner.stop(), runningLine);
  },
  settled: () => {
    const message = settledMessage(holding !== null, explorer !== null);

    if (message !== null) {
      showMessage(content, message);
    }

    holding = null;
    releaseFirstScan();
    releaseFirstScan = () => {};
    refreshDoctor();
  },
  hasExplorer: () => explorer !== null,
  blocked: (text) => {
    if (explorer === null) {
      showMessage(content, text, true);
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

void scanSource.watchExternal().catch((error: unknown) => {
  footerView.post({ kind: "error", text: String(error) });
});

const openActions = {
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

  openView = showOpen(content, openActions);
  renderOpenProgress();
  openTick = window.setInterval(renderOpenProgress, 1000);
}

function hideOpenProgress() {
  if (openTick !== null) {
    window.clearInterval(openTick);
    openTick = null;
  }

  openView?.remove();
  openView = null;
}

function showOpenStopped() {
  openView = showOpen(content, openActions);
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
    showEmpty(content, () => {
      void repositorySource.chooseFolder().catch((error: unknown) => {
        footerView.post({ kind: "error", text: String(error) });
      });
    });

    return;
  }

  setScanRepository(folder);
  void sensorsSource.watchInputs().catch(() => {});
  folderName = folder.split(/[\\/]/).filter(Boolean).pop() ?? folder;
  content.replaceChildren();

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

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
    event.preventDefault();
    explorer?.toggleTree();
  }
});

void getCurrentWebviewWindow().listen("settings-changed", () =>
  explorer?.refreshResponsibilities(),
);
void getCurrentWebviewWindow().listen("open-in-editor", () =>
  explorer?.openSelectedInEditor(),
);

void getCurrentWebviewWindow().listen("view-link", () =>
  explorer?.openLinkedView(),
);

const onInputsChanged = inputsRefresh({
  refresh: () => rescanner.refresh(),
  doctor: runDoctor,
  flight: refreshDoctor,
});

sensorsSource.onInputsChanged(() => void onInputsChanged());

void repositorySource.onRescan(() => void rescanner.run());

void repositorySource.onOpenSettings(openSettings);

document.addEventListener("keydown", (event) => {
  if (event.metaKey && event.key === ",") {
    event.preventDefault();
    openSettings();
  }
});

void repositorySource.onChanges(
  createChangesHandler({
    state: () => scanState,
    setState: setScanState,
    refreshPanel: () => explorer?.refreshPanel(),
  }),
);

void repositorySource.onFolderAssigned(() => void start());

start().catch((error: unknown) => showMessage(content, String(error), true));
