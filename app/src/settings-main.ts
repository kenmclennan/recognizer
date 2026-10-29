import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./style.css";
import { settingsSource } from "./settings-source";
import { buildSettings } from "./settings-view";

const WIDTH = 480;

const container = document.getElementById("settings");

if (container === null) {
  throw new Error("missing #settings");
}

function fitWindow(): void {
  const height = Math.ceil(container?.getBoundingClientRect().height ?? 0);

  if (height > 0) {
    void getCurrentWindow().setSize(new LogicalSize(WIDTH, height));
  }
}

function close(): void {
  void getCurrentWindow().close();
}

function fail(error: unknown): void {
  view.showError(error instanceof Error ? error.message : String(error));
  fitWindow();
}

const view = buildSettings(container, {
  cancel: close,
  save(values) {
    settingsSource.write(values).then(close, fail);
  },
});

settingsSource.read().then((loaded) => {
  view.fill(loaded);
  fitWindow();
}, fail);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    close();
  }
});
