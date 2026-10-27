import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import "./style.css";
import { showEmpty } from "./empty-view";
import { type Explorer, showExplorer } from "./explorer";
import { buildFooter } from "./footer-view";
import { showMessage } from "./message-view";
import { repositorySource } from "./repository-source";
import { loadScans } from "./scan-loading";
import { dialogFromOutcome } from "./update-dialog";
import { buildUpdateDialog } from "./update-dialog-view";
import { buildUpdater } from "./updater";
import { tauriUpdaterPorts } from "./updater-source";

const content = document.getElementById("content") as HTMLElement;
const footer = document.getElementById("footer") as HTMLElement;

const footerView = buildFooter(footer);

const updater = buildUpdater({
  ...tauriUpdaterPorts,
  enabled: import.meta.env.PROD,
  onState: (state) => footerView.setUpdate(state, () => void updater.install()),
  notify: (text) => footerView.notify(text),
});

updater.start();

const updateDialog = buildUpdateDialog(
  document.getElementById("update-dialog") as HTMLElement,
  {
    currentVersion: () => getVersion(),
    upgrade: () => void upgradeFromDialog(),
  },
);

async function upgradeFromDialog(): Promise<void> {
  const state = updater.state();

  if (state.kind !== "available") {
    return;
  }

  updateDialog.show({ kind: "upgrading", version: state.version });

  const result = await updater.install();

  if (!result.ok) {
    updateDialog.show({
      kind: "found",
      version: state.version,
      error: result.reason,
    });
  }
}

async function checkForUpdates(): Promise<void> {
  const state = updater.state();

  if (state.kind === "installing") {
    updateDialog.show({ kind: "upgrading", version: state.version });

    return;
  }

  updateDialog.show({ kind: "checking" });

  const outcome = await updater.checkNow();

  if (updateDialog.isOpen()) {
    updateDialog.show(dialogFromOutcome(outcome));
  }
}

let explorer: Explorer | null = null;

async function start(): Promise<void> {
  explorer = null;
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

  showMessage(content, "Scanning...");

  const loaded = loadScans(await repositorySource.scanFolder());

  if (loaded.blocking !== null) {
    showMessage(content, loaded.blocking, true);

    return;
  }

  explorer = showExplorer(
    content,
    loaded,
    folder.split(/[\\/]/).filter(Boolean).pop() ?? folder,
    (text) => footerView.setCount(text),
  );
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && updateDialog.dismiss()) {
    event.preventDefault();

    return;
  }

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
    event.preventDefault();
    explorer?.toggleTree();
  }
});

void getCurrentWebviewWindow().listen(
  "check-updates",
  () => void checkForUpdates(),
);

void repositorySource.onFolderAssigned(() => void start());

start().catch((error: unknown) => showMessage(content, String(error), true));
