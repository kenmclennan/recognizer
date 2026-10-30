import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import "./style.css";
import { createBusyGate } from "./busy-gate";
import { editorSource } from "./editor-source";
import { showEmpty } from "./empty-view";
import { type Carried, type Explorer, showExplorer } from "./explorer";
import { NO_CHANGES, type ScanOrigin, type ScanState } from "./footer-scan";
import { buildFooter } from "./footer-view";
import { showMessage } from "./message-view";
import { repositorySource } from "./repository-source";
import { createRescanner } from "./rescanner";
import { responsibilitiesSource } from "./responsibilities-source";
import { type Loaded, loadScans } from "./scan-loading";
import { spinner } from "./spinner-view";
import { toolsNotice } from "./tools-notice";
import { toolsSource } from "./tools-source";
import { viewsSource } from "./views-source";

const content = document.getElementById("content") as HTMLElement;
const footer = document.getElementById("footer") as HTMLElement;

const footerView = buildFooter(footer, () => void rescanner.run());

let explorer: Explorer | null = null;
let folderName = "";
let scanState: ScanState | null = null;

function setScanState(next: ScanState | null) {
  scanState = next;
  footerView.setScan(next);
}

function adoptedOrigin(origin: ScanOrigin) {
  setScanState({
    origin,
    scannedAt: Date.now(),
    changes: NO_CHANGES,
    rescanning: false,
  });
}

function buildExplorer(loaded: Loaded, carried: Carried | null): Explorer {
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
  scan: () => repositorySource.scanFolder(),
  load: loadScans,
  adopt: () => repositorySource.adoptScan(),
  carry: () => explorer?.carry() ?? null,
  replace: (loaded, carried) => {
    explorer?.dispose();
    explorer = buildExplorer(loaded, carried);
    void checkTools();
  },
  running: (on) => {
    content.classList.toggle("rescanning", on);

    if (scanState !== null) {
      setScanState({ ...scanState, rescanning: on });
    }
  },
  adopted: adoptedOrigin,
  notify: (text) => footerView.notify(text),
});

async function start(): Promise<void> {
  explorer?.dispose();
  explorer = null;
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

  content.replaceChildren();

  const scanning = spinner("Scanning");

  scanning.classList.add("scan-busy");

  const loaded = loadScans(
    await createBusyGate(
      () => content.replaceChildren(scanning),
      () => scanning.remove(),
    ).run(repositorySource.scanFolder()),
  );

  if (loaded.blocking !== null) {
    showMessage(content, loaded.blocking, true);

    return;
  }

  adoptedOrigin(await repositorySource.adoptScan());
  folderName = folder.split(/[\\/]/).filter(Boolean).pop() ?? folder;
  explorer = buildExplorer(loaded, null);
  explorer.openLinkedView();
  void checkTools();
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

void repositorySource.onRescan(() => void rescanner.run());

void repositorySource.onChanges((changes) => {
  if (scanState !== null) {
    setScanState({ ...scanState, changes });
  }
});

void repositorySource.onFolderAssigned(() => void start());

start().catch((error: unknown) => showMessage(content, String(error), true));
