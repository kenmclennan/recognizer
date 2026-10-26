import { el } from "./dom";
import { icon } from "./icons";
import type { InspectorContent, InspectorTab, Row } from "./inspector-model";
import type { CallerButton } from "./member-callers";

export type InspectorActions = {
  open: () => void;
  close: () => void;
  setTab: (tab: InspectorTab) => void;
  toggleFold: (key: string) => void;
  openFile: (id: string) => void;
  hover: (name: string | null) => void;
  openCallers: (button: CallerButton) => void;
};

export type InspectorView = {
  element: HTMLElement;
  render: (content: InspectorContent, open: boolean) => void;
};

function disc(kind: string): HTMLElement {
  return el("span", `disc disc-${kind}`);
}

function hoverable(node: HTMLElement, name: string, actions: InspectorActions) {
  node.addEventListener("mouseenter", () => actions.hover(name));
  node.addEventListener("mouseleave", () => actions.hover(null));
}

function callerNode(button: CallerButton | null, actions: InspectorActions) {
  if (button === null) {
    return [];
  }

  const node = el("button", "cb", button.text);

  node.type = "button";
  node.title = button.title;
  node.addEventListener("click", (event) => {
    event.stopPropagation();
    actions.openCallers(button);
  });

  return [node];
}

function evidenceNode(row: Extract<Row, { kind: "evidence" }>) {
  const { section } = row;
  const block = el("div", "evidence");

  block.append(
    el("div", "where", section.where),
    el("code", "quoted", section.quoted),
  );

  if (section.names) {
    block.append(el("div", "", `names: ${section.names}`));
  }

  if (section.route) {
    block.append(el("div", "", `via: ${section.route}`));
  }

  for (const part of section.inferred) {
    block.append(el("div", "", part));
  }

  return block;
}

function rowNode(row: Row, actions: InspectorActions): HTMLElement {
  if (row.kind === "heading") {
    return el("div", "oh", row.text);
  }

  if (row.kind === "note") {
    return el("p", "", row.text);
  }

  if (row.kind === "none") {
    return el("div", "none", "None");
  }

  if (row.kind === "class") {
    const node = el("div", "oc");

    node.append(
      row.name,
      el("span", "t", row.tags),
      ...callerNode(row.button, actions),
    );
    hoverable(node, row.name, actions);

    return node;
  }

  if (row.kind === "base") {
    const node = el("div", "ob", row.text);

    hoverable(node, row.hover, actions);

    return node;
  }

  if (row.kind === "member") {
    const node = el(
      "div",
      `om${row.top ? " top" : ""}${row.muted ? " priv" : ""}`,
    );
    const text = el("span", "", row.text);

    if (row.tags !== "") {
      text.append(" ", el("span", "tag", row.tags));
    }

    node.append(text, ...callerNode(row.button, actions));
    hoverable(node, row.hover, actions);

    return node;
  }

  if (row.kind === "fold") {
    const node = el("div", `ofold${row.top ? " top" : ""}`);

    node.append(icon(row.open ? "chevron-down" : "chevron-right"), row.text);
    node.addEventListener("click", (event) => {
      event.stopPropagation();
      actions.toggleFold(row.key);
    });

    return node;
  }

  if (row.kind === "folder") {
    const node = el("div", "lnk");
    const label = el("span");

    label.append(el("b", "", row.name), " ", el("span", "muted", row.count));
    node.append(disc(row.disc), label);

    return node;
  }

  if (row.kind === "file") {
    const node = el("div", `lnk${row.on ? " on" : ""}`);
    const label = el("span", "", row.name);

    node.title = row.title;

    if (row.summary !== "") {
      label.append(" ", el("span", "muted", row.summary));
    }

    node.append(disc(row.disc), label);
    node.addEventListener("click", () => actions.openFile(row.id));

    return node;
  }

  if (row.kind === "group") {
    const node = el("div", "lnk");

    node.title = "Click to select it";
    node.append(disc(row.disc), el("span", "", row.path));
    node.addEventListener("click", () => actions.openFile(row.id));

    return node;
  }

  if (row.kind === "finding") {
    const node = el("div", `finding ${row.severity}`);

    node.append(el("div", "", row.text), el("div", "muted", row.why));

    return node;
  }

  return evidenceNode(row);
}

export function buildInspectorView(actions: InspectorActions): InspectorView {
  const element = el("aside", "inspector");
  const rail = el("div", "inspector-rail");
  const panel = el("div", "inspector-panel");
  const opener = el("button", "ib");
  let shown: string | null = null;

  opener.type = "button";
  opener.title = "Open the inspector";
  opener.setAttribute("aria-label", "Open the inspector");
  opener.append(icon("panel-right"));
  opener.addEventListener("click", (event) => {
    event.stopPropagation();
    actions.open();
  });
  rail.append(opener);
  element.append(rail, panel);

  return {
    element,
    render(content, open) {
      element.classList.toggle("open", open);
      rail.hidden = open;
      panel.hidden = !open;

      if (!open) {
        return;
      }

      const head = el("div", "ih");
      const close = el("button", "ib");

      if (content.header.disc !== null) {
        head.append(disc(content.header.disc));
      }

      head.append(el("b", "", content.header.title));

      if (content.header.muted !== "") {
        head.append(el("span", "muted", content.header.muted));
      }

      close.type = "button";
      close.title = "Close the inspector";
      close.setAttribute("aria-label", "Close the inspector");
      close.append(icon("x"));
      close.addEventListener("click", (event) => {
        event.stopPropagation();
        actions.close();
      });
      head.append(el("span", "grow"), close);

      const parts: HTMLElement[] = [head];

      if (content.tabs) {
        const tabs = el("div", "itabs");

        for (const tab of content.tabs) {
          const node = el("button", tab.active ? "on" : "", tab.label);

          node.type = "button";
          node.addEventListener("click", (event) => {
            event.stopPropagation();
            actions.setTab(tab.tab);
          });
          tabs.append(node);
        }

        parts.push(tabs);
      }

      parts.push(...content.rows.map((row) => rowNode(row, actions)));
      panel.replaceChildren(...parts);

      if (shown !== content.key) {
        panel.scrollTop = 0;
        shown = content.key;
      }
    },
  };
}
