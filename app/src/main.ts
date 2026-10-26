import "./style.css";
import { showEmpty } from "./empty-view";
import { type Explorer, showExplorer } from "./explorer";
import { buildFooter } from "./footer-view";
import { showMessage } from "./message-view";
import { repositorySource } from "./repository-source";
import { loadScans } from "./scan-loading";
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

let explorer: Explorer | null = null;

async function start(): Promise<void> {
  explorer = null;

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
  );
}

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
    event.preventDefault();
    explorer?.toggleTree();
  }
});

void repositorySource.onFolderAssigned(() => void start());

start().catch((error: unknown) => showMessage(content, String(error), true));
