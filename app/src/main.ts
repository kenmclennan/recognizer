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
import { createRescanner, type ProgressUpdate } from "./rescanner";
import { responsibilitiesSource } from "./responsibilities-source";
import { type Loaded, loadScans } from "./scan-loading";
import { describerOf, registeredNames } from "./scan-panel-model";
import { showTarget } from "./scan-progress";
import { scanSource } from "./scan-source";
import { withSensors } from "./sensor-run";
import { sensorsSource } from "./sensors-source";
import { spinner } from "./spinner-view";
import { toolsNotice } from "./tools-notice";
import { toolsSource } from "./tools-source";
import { viewsSource } from "./views-source";
import { windowSource } from "./window-source";

const content = document.getElementById("content") as HTMLElement;
const footer = document.getElementById("footer") as HTMLElement;

const footerView = buildFooter(footer, {
  rescan: () => void rescanner.run(),
  stop: () => void rescanner.stop(),
  show: showFailure,
  openLog,
});

let explorer: Explorer | null = null;
let folderName = "";
let scanState: ScanState | null = null;
let current: Loaded | null = null;
let shownProgress: ProgressUpdate = { footer: null, target: null, log: null };
let releaseFirstScan: () => void = () => {};

const sensed = (loaded: Loaded) => withSensors(loaded, sensorsSource);

function setScanState(next: ScanState | null) {
  scanState = next;
  footerView.setScan(next);
}

function canShow(update: ProgressUpdate): boolean {
  const { target } = update;

  return (
    target !== null &&
    (target.kind === "sensor" || current?.modules.includes(target.id) === true)
  );
}

function withProgress(
  state: Omit<ScanState, "progress" | "canShow" | "log">,
): ScanState {
  return {
    ...state,
    progress: shownProgress.footer,
    canShow: canShow(shownProgress),
    log: shownProgress.log,
  };
}

function adoptedOrigin(origin: ScanOrigin) {
  setScanState(
    withProgress({
      origin,
      scannedAt: Date.now(),
      changes: NO_CHANGES,
    }),
  );
}

function showFailure() {
  const target = showTarget(rescanner.progress());

  if (target !== null) {
    explorer?.show(target);
  }
}

function openLog() {
  const { log } = shownProgress;

  if (log !== null) {
    void editorSource
      .openFile(log)
      .catch((error: unknown) => footerView.notify(String(error)));
  }
}

const scanHost: ScanHost = {
  port: sensorsSource,
  scan: () => scanState,
  ticks: () => rescanner.ticks(),
  setTicks: (next) => rescanner.setTicks(next),
  runState: () => rescanner.runState(),
  running: () => rescanner.running(),
  run: () => void rescanner.run(),
  stop: () => void rescanner.stop(),
};

function buildExplorer(loaded: Loaded, carried: Carried | null): Explorer {
  current = loaded;

  return showExplorer(
    content,
    loaded,
    folderName,
    (text) => footerView.setCount(text),
    viewsSource,
    (text) => footerView.notify(text),
    carried,
    undefined,
    localStorage,
    editorSource,
    responsibilitiesSource,
    windowSource,
    (line) => footerView.setAgentLine(line),
    scanHost,
  );
}

async function checkTools(): Promise<void> {
  try {
    const [appVersion, report] = await Promise.all([
      getVersion(),
      toolsSource.recognizerVersion(),
    ]);

    footerView.setToolsNotice(toolsNotice(appVersion, report));
  } catch {
    footerView.setToolsNotice(null);
  }
}

const rescanner = createRescanner<Carried>({
  port: scanSource,
  registered: async () => {
    const { config } = await sensorsSource.readInputs();

    return {
      names: registeredNames(config),
      describer: describerOf(config) !== null,
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
    void checkTools();
  },
  adopted: adoptedOrigin,
  describedLine: () => explorer?.refreshResponsibilities(),
  progress: (update) => {
    shownProgress = update;

    if (scanState !== null) {
      setScanState(withProgress(scanState));
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
      footerView.notify(`Rescan failed: ${text}`);
    }
  },
  notify: (text) => footerView.notify(text),
});

async function start(): Promise<void> {
  await rescanner.stop();
  explorer?.dispose();
  explorer = null;
  current = null;
  shownProgress = { footer: null, target: null, log: null };
  setScanState(null);
  footerView.setCount("");

  const folder = await repositorySource.windowFolder();

  if (folder === null) {
    showEmpty(content, () => {
      void repositorySource.chooseFolder().catch((error: unknown) => {
        footerView.notify(String(error));
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
