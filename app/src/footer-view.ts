import { getVersion } from "@tauri-apps/api/app";
import { APP_NAME } from "./app-info";
import { el } from "./dom";
import { type ScanState, scanLine } from "./footer-scan";
import {
  createMessageTray,
  type MessageInput,
  realTimer,
} from "./message-tray";
import { buildTrayView } from "./message-tray-view";

function footerButton(
  label: string,
  className: string,
  onClick: () => void,
): HTMLElement {
  const node = el("button", className, label);

  node.type = "button";
  node.addEventListener("click", () => onClick());

  return node;
}

export type FooterView = {
  post: (input: MessageInput) => number | null;
  withdraw: (id: number) => void;
  relabel: (id: number, label: string) => void;
  reconcile: (foundKeys: readonly string[]) => void;
  setCount: (text: string) => void;
  setMetrics: (text: string | null) => void;
  setScan: (state: ScanState | null) => void;
};

const AGE_REFRESH_MS = 30000;

export type FooterActions = {
  rescan: () => void;
  stop: () => void;
  show: () => void;
  openLog: () => void;
};

const NO_ACTIONS: FooterActions = {
  rescan: () => {},
  stop: () => {},
  show: () => {},
  openLog: () => {},
};

export function buildFooter(
  container: HTMLElement,
  actions: Partial<FooterActions> = {},
): FooterView {
  const { rescan, stop, show, openLog } = { ...NO_ACTIONS, ...actions };
  const identity = document.createElement("span");
  const count = document.createElement("span");
  const scan = el("span", "scan-line");
  const metrics = el("span", "metrics-line");
  const gap = el("span", "footer-gap");
  const tray = createMessageTray(Date.now, realTimer);
  const trayView = buildTrayView(tray);
  const list = el("div", "changes-list");
  let scanState: ScanState | null = null;
  let listOpen = false;

  identity.className = "identity";
  identity.textContent = APP_NAME;
  count.className = "module-count";
  count.id = "module-count";
  metrics.hidden = true;
  metrics.setAttribute("role", "status");
  list.hidden = true;
  container.replaceChildren(
    identity,
    count,
    scan,
    metrics,
    gap,
    trayView.bell,
    trayView.tray,
    trayView.toast,
    list,
  );

  void getVersion().then((version) => {
    identity.textContent = `${APP_NAME} ${version}`;
  });

  function closeList() {
    listOpen = false;
    list.hidden = true;
  }

  function renderScan() {
    if (scanState === null) {
      scan.replaceChildren();
      closeList();

      return;
    }

    const line = scanLine(scanState, Date.now());
    const parts: HTMLElement[] = [];

    scan.className = `scan-line ${line.tone}`;

    if (line.kind === "files") {
      const open = el("button", "scan-count", line.text);

      open.type = "button";
      open.setAttribute("aria-expanded", String(listOpen));
      open.addEventListener("click", (event) => {
        event.stopPropagation();
        listOpen = !listOpen;
        list.hidden = !listOpen;
        open.setAttribute("aria-expanded", String(listOpen));
      });
      parts.push(open);
    } else {
      parts.push(el("span", "scan-text", line.text));
    }

    if (line.rescan !== "none") {
      const run = el("button", "rescan-button", "Rescan");

      run.type = "button";
      run.disabled = line.rescan === "disabled";
      run.addEventListener("click", () => rescan());
      parts.push(run);
    }

    if (line.stop) {
      parts.push(footerButton("Stop", "scan-stop", stop));
    }

    if (line.show) {
      parts.push(el("span", "scan-dot", "\u00b7"));
      parts.push(footerButton("Show", "scan-show", show));
    }

    if (line.openLog) {
      parts.push(el("span", "scan-dot", "\u00b7"));
      parts.push(footerButton("Open log", "scan-open-log", openLog));
    }

    scan.replaceChildren(...parts);

    if (line.kind !== "files") {
      closeList();
    }

    list.replaceChildren(
      ...line.files.map((file) => {
        const row = el("div", "changes-row");

        row.append(
          el("span", `change-kind ${file.kind}`, file.kind),
          el("span", "change-path", file.path),
        );

        return row;
      }),
    );
  }

  document.addEventListener("click", (event) => {
    if (listOpen && !list.contains(event.target as Node)) {
      closeList();
      renderScan();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && listOpen) {
      closeList();
      renderScan();
    }
  });
  setInterval(renderScan, AGE_REFRESH_MS);

  return {
    post: (input) => tray.post(input),
    withdraw: (id) => tray.withdraw(id),
    relabel: (id, label) => tray.relabel(id, label),
    reconcile: (foundKeys) => tray.reconcile(foundKeys),
    setCount(text) {
      count.textContent = text;
    },
    setMetrics(text) {
      metrics.textContent = text ?? "";
      metrics.hidden = text === null;
    },
    setScan(state) {
      scanState = state;
      renderScan();
    },
  };
}
