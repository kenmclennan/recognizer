import { getVersion } from "@tauri-apps/api/app";
import { APP_NAME } from "./app-info";
import { el } from "./dom";
import {
  createMessageTray,
  type MessageAction,
  type MessageInput,
  realTimer,
} from "./message-tray";
import { buildTrayView } from "./message-tray-view";

export type FooterView = {
  post: (input: MessageInput) => number | null;
  attach: (id: number, extra: MessageAction) => void;
  withdraw: (id: number) => void;
  relabel: (id: number, label: string) => void;
  reconcile: (foundKeys: readonly string[]) => void;
  setCount: (text: string) => void;
  setScan: (text: string | null) => void;
};

export function buildFooter(container: HTMLElement): FooterView {
  const identity = document.createElement("span");
  const count = document.createElement("span");
  const scan = el("span", "scan-line");
  const gap = el("span", "footer-gap");
  const tray = createMessageTray(Date.now, realTimer);
  const trayView = buildTrayView(tray);

  identity.className = "identity";
  identity.textContent = APP_NAME;
  count.className = "module-count";
  count.id = "module-count";
  container.replaceChildren(
    identity,
    count,
    scan,
    gap,
    trayView.bell,
    trayView.tray,
    trayView.toast,
  );

  void getVersion().then((version) => {
    identity.textContent = `${APP_NAME} ${version}`;
  });

  function renderScan(text: string | null) {
    scan.replaceChildren(
      ...(text === null ? [] : [el("span", "scan-text", text)]),
    );
  }

  return {
    post: (input) => tray.post(input),
    attach: (id, extra) => tray.attach(id, extra),
    withdraw: (id) => tray.withdraw(id),
    relabel: (id, label) => tray.relabel(id, label),
    reconcile: (foundKeys) => tray.reconcile(foundKeys),
    setCount(text) {
      count.textContent = text;
    },
    setScan(text) {
      renderScan(text);
    },
  };
}
