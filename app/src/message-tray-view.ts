import { el } from "./dom";
import { type IconName, icon } from "./icons";
import type {
  MessageKind,
  MessageRow,
  MessageTray,
  TraySnapshot,
} from "./message-tray";

const KIND_ICONS: Record<MessageKind, IconName> = {
  warning: "triangle-alert",
  error: "circle-x",
  done: "check",
  info: "info",
};

export type TrayElements = {
  bell: HTMLElement;
  tray: HTMLElement;
  toast: HTMLElement;
};

function card(row: MessageRow, tray: MessageTray, withWhen: boolean) {
  const node = el("div", `msg ${row.kind}${row.unread ? " unread" : ""}`);
  const body = el("div", "msg-body");
  const text = el("span", "msg-text", row.text);

  body.append(text);

  if (row.action !== null) {
    const act = el("button", "msg-act", row.action);

    act.type = "button";
    act.addEventListener("click", (event) => {
      event.stopPropagation();
      tray.act(row.id);
    });
    body.append(act);
  }

  if (withWhen) {
    body.append(el("div", "msg-when", row.when));
  }

  node.append(icon(KIND_ICONS[row.kind], "msg-icon"), body);

  return node;
}

export function buildTrayView(tray: MessageTray): TrayElements {
  const bell = el("button", "bell");
  const badge = el("span", "bell-badge");
  const panel = el("div", "message-tray");
  const header = el("div", "message-tray-header");
  const clear = el("button", "message-clear", "Clear");
  const list = el("div", "message-list");
  const toast = el("div", "message-toast");

  bell.type = "button";
  bell.append(icon("bell"), badge);
  clear.type = "button";
  header.append(el("span", "message-tray-title", "Messages"), clear);
  list.setAttribute("aria-live", "off");
  panel.append(header, list);
  toast.setAttribute("role", "status");
  panel.hidden = true;
  toast.hidden = true;
  badge.hidden = true;

  function draw({
    rows,
    badge: shown,
    trayOpen,
    toast: current,
  }: TraySnapshot) {
    const unread = rows.filter((row) => row.unread).length;

    badge.hidden = shown.hidden;
    badge.textContent = String(shown.count);
    badge.className = `bell-badge${shown.tone === "grey" ? " quiet" : ""}`;
    bell.className = `bell${trayOpen ? " open" : ""}`;
    bell.setAttribute(
      "aria-label",
      unread > 0 ? `Messages, ${unread} unread` : "Messages",
    );
    bell.setAttribute("aria-expanded", String(trayOpen));
    panel.hidden = !trayOpen;
    list.replaceChildren(
      ...(rows.length === 0
        ? [el("div", "message-empty", "Nothing to report")]
        : rows.map((row) => card(row, tray, true))),
    );
    toast.hidden = current === null;
    toast.replaceChildren(
      ...(current === null ? [] : [card(current, tray, false)]),
    );
  }

  bell.addEventListener("click", (event) => {
    event.stopPropagation();

    if (tray.snapshot().trayOpen) {
      tray.close();
    } else {
      tray.open();
    }
  });
  clear.addEventListener("click", (event) => {
    event.stopPropagation();
    tray.clear();
  });
  panel.addEventListener("click", (event) => event.stopPropagation());
  document.addEventListener("click", (event) => {
    if (
      tray.snapshot().trayOpen &&
      !panel.contains(event.target as Node) &&
      !bell.contains(event.target as Node)
    ) {
      tray.close();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && tray.snapshot().trayOpen) {
      tray.close();
    }
  });
  tray.subscribe(() => draw(tray.snapshot()));
  draw(tray.snapshot());

  return { bell, tray: panel, toast };
}
