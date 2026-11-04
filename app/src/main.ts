import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import "./style.css";
import { createBusyGate } from "./busy-gate";
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
import { showMessage } from "./message-view";
import { repositorySource } from "./repository-source";
import { createRescanner } from "./rescanner";
import { responsibilitiesSource } from "./responsibilities-source";
import { type Loaded, loadScans } from "./scan-loading";
import { rowSensors } from "./scan-panel-model";
import { scanSource } from "./scan-source";
import { withSensors } from "./sensor-run";
import { sensorsSource } from "./sensors-source";
import { spinner } from "./spinner-view";
import { postToolsMessage, TOOLS_KEY } from "./tools-notice";
import { createToolsRecheck } from "./tools-recheck";
import { toolsSource } from "./tools-source";
import { createViewComparisons } from "./view-comparisons";
import { viewsSource } from "./views-source";
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
let explorerKeys: readonly string[] = [];
let toolsFound = false;

const sensed = (loaded: Loaded) => withSensors(loaded, sensorsSource);

function setScanState(next: ScanState | null) {
  scanState = next;
  footerView.setScan(next);
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
  scan: () => scanState,
  ticks: () => rescanner.ticks(),
  setTicks: (next) => rescanner.setTicks(next),
  runState: () => rescanner.runState(),
  running: () => rescanner.running(),
  progressText: () => runningLine,
  describeProgress: () => {
    const describe = rescanner.progress().describe;

    return describe === null
      ? null
      : { entries: describe.entries.length, total: describe.total };
  },
  run: () => void rescanner.run(),
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
    (text) => footerView.setMetrics(text),
    (id) => footerView.withdraw(id),
    (keys) => {
      explorerKeys = keys;
      reconcileKeys();
    },
    comparisons,
  );
}

function reconcileKeys() {
  footerView.reconcile([...explorerKeys, ...(toolsFound ? [TOOLS_KEY] : [])]);
}

const toolsRecheck = createToolsRecheck({
  now: () => Date.now(),
  read: async () => {
    const [appVersion, report] = await Promise.all([
      getVersion(),
      toolsSource.recognizerVersion(),
    ]);

    return { appVersion, report };
  },
  show: (notice, fresh) => {
    toolsFound = notice !== null;

    if (notice !== null && fresh) {
      postToolsMessage(notice, footerView, (text) => viewsSource.copy(text));
    }

    reconcileKeys();
  },
});

window.addEventListener("focus", () => {
  void toolsRecheck.onFocus();
});

const rescanner = createRescanner<Carried>({
  port: scanSource,
  registered: async () => {
    const { config } = await sensorsSource.readInputs();
    const shipped = await sensorsSource
      .shipped()
      .catch(() => ({ status: "unavailable" as const, reason: "" }));

    return rowSensors(config, shipped);
  },
  load: loadScans,
  sense: sensed,
  resense: async () => (current === null ? null : sensed(current)),
  adopt: () => repositorySource.adoptScan(),
  carry: () => explorer?.carry() ?? null,
  replace: (loaded, carried) => {
    explorer?.dispose();
    explorer = buildExplorer(loaded, carried);
    void toolsRecheck.onOpen();
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

    if (scanState !== null) {
      setScanState({ ...scanState, scanning: runningLine });
    }

    explorer?.refreshPanel();
  },
  settled: () => {
    releaseFirstScan();
    releaseFirstScan = () => {};
  },
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
  openLog: (log) => {
    void editorSource
      .openFile(log)
      .catch((error: unknown) =>
        footerView.post({ kind: "error", text: String(error) }),
      );
  },
});

async function start(): Promise<void> {
  await rescanner.stop();
  explorer?.dispose();
  explorer = null;
  current = null;
  runningLine = null;
  setScanState(null);
  footerView.setCount("");

  const folder = await repositorySource.windowFolder();

  if (folder === null) {
    showEmpty(content, () => {
      void repositorySource.chooseFolder().catch((error: unknown) => {
        footerView.post({ kind: "error", text: String(error) });
      });
    });

    return;
  }

  folderName = folder.split(/[\\/]/).filter(Boolean).pop() ?? folder;
  content.replaceChildren();

  const scanning = spinner("Scanning");

  scanning.classList.add("scan-busy");

  const firstSettled = new Promise<void>((resolve) => {
    releaseFirstScan = resolve;
  });

  void rescanner.run();

  await createBusyGate(
    () => content.replaceChildren(scanning),
    () => scanning.remove(),
  ).run(firstSettled);

  if (explorer === null) {
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

void getCurrentWebviewWindow().listen("open-in-editor", () =>
  explorer?.openSelectedInEditor(),
);

void getCurrentWebviewWindow().listen("view-link", () =>
  explorer?.openLinkedView(),
);

sensorsSource.onInputsChanged(() => void rescanner.refresh());

void repositorySource.onRescan(() => void rescanner.run());

void repositorySource.onChanges((changes) => {
  if (scanState !== null) {
    setScanState({ ...scanState, changes });
  }
});

void repositorySource.onFolderAssigned(() => void start());

start().catch((error: unknown) => showMessage(content, String(error), true));
