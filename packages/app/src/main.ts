import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import "./style.css";
import { composeApp } from "./app-root";
import { domViewOver } from "./dom-view";
import { buildFooter } from "./footer-view";

const content = document.getElementById("content") as HTMLElement;
const footer = buildFooter(document.getElementById("footer") as HTMLElement);

const domView = domViewOver(content, footer);

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
