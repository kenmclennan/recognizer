import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import "./style.css";
import { type AppView, composeApp } from "./app-root";
import { commitsSource } from "./commits-source";
import { editorSource } from "./editor-source";
import { showEmpty } from "./empty-view";
import { showExplorer } from "./explorer";
import { buildFooter } from "./footer-view";
import { showHolding } from "./holding-view";
import { showMessage } from "./message-view";
import { responsibilitiesSource } from "./responsibilities-source";
import { showOpen } from "./scan-open-view";
import { openSettingsModal } from "./settings-modal-view";
import { openSetupModal } from "./setup-modal-view";
import { viewsSource } from "./views-source";
import { createVisualisationSource } from "./visualisation-source";
import { windowSource } from "./window-source";

const content = document.getElementById("content") as HTMLElement;
const footer = buildFooter(document.getElementById("footer") as HTMLElement);

const domView: AppView = {
  footer,
  clear: () => content.replaceChildren(),
  showEmpty: (choose) => showEmpty(content, choose),
  showMessage: (text, isError) => showMessage(content, text, isError),
  showHolding: (stop, line) => showHolding(content, stop, line),
  showOpen: (actions) => showOpen(content, actions),
  showExplorer: (request) =>
    showExplorer(
      content,
      request.loaded,
      request.folderName,
      (text) => footer.setCount(text),
      viewsSource,
      (input) => footer.post(input),
      request.carried,
      undefined,
      localStorage,
      editorSource,
      responsibilitiesSource,
      windowSource,
      request.scanHost,
      (id) => footer.withdraw(id),
      request.onKeys,
      request.comparisons,
      commitsSource,
      request.openSettings,
      request.openSetup,
      undefined,
      createVisualisationSource(),
    ),
  openSettings: openSettingsModal,
  openSetup: openSetupModal,
};

const app = composeApp(domView);

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
    event.preventDefault();
    app.toggleTree();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.metaKey && event.key === ",") {
    event.preventDefault();
    app.openSettings();
  }
});

void getCurrentWebviewWindow().listen("settings-changed", () =>
  app.refreshResponsibilities(),
);
void getCurrentWebviewWindow().listen("open-in-editor", () =>
  app.openSelectedInEditor(),
);
void getCurrentWebviewWindow().listen("view-link", () => app.openLinkedView());
