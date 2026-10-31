import { getCurrentWindow } from "@tauri-apps/api/window";
import "./style.css";
import { settingsSource } from "./settings-source";
import { buildSettings } from "./settings-view";

const container = document.getElementById("settings");

if (container === null) {
  throw new Error("missing #settings");
}

function close(): void {
  void getCurrentWindow().close();
}

function fail(error: unknown): void {
  view.showError(error instanceof Error ? error.message : String(error));
}

const view = buildSettings(container, {
  cancel: close,
  save(values) {
    settingsSource.write(values).then(close, fail);
  },
});

settingsSource.read().then((loaded) => {
  view.fill(loaded);
}, fail);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    close();
  }
});
