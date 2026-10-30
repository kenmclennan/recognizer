import type { Token } from "./card-code";
import { el } from "./dom";
import { icon, iconButton } from "./icons";
import type {
  CardRow,
  InspectorContent,
  InspectorTab,
  Row,
} from "./inspector-model";
import { nextCheck } from "./row-model";
import { buildRow } from "./row-view";

export type InspectorActions = {
  open: () => void;
  close: () => void;
  setTab: (tab: InspectorTab) => void;
  toggleFold: (key: string) => void;
  openFile: (id: string) => void;
  hover: (name: string | null) => void;
  putOnCanvas: (ids: string[]) => void;
  takeOff: (ids: string[]) => void;
  pickName: (id: string) => void;
  toggleGroup: (key: string) => void;
  setFilter: (text: string) => void;
  openInEditor: (target: { kind: "module" | "folder"; id: string }) => void;
  setShowPrivate: (on: boolean) => void;
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

function tokenNodes(tokens: Token[]): HTMLElement[] {
  return tokens.map((token) => el("span", `tk-${token.role}`, token.text));
}

function privateMark(): HTMLElement {
  return el("span", "pmark", "private");
}

function cardNode(row: CardRow, actions: InspectorActions): HTMLElement {
  const node = el(
    "div",
    `card card-${row.label.toLowerCase()}${row.private ? " priv" : ""}`,
  );
  const label = el("div", "card-label");
  const head = el("div", "card-code");

  label.append(el("span", "card-kind", row.label));

  if (row.private) {
    label.append(privateMark());
  }

  label.append(el("span", "card-line", row.line === null ? "" : `${row.line}`));
  head.append(...tokenNodes(row.head));
  node.append(label, head);

  for (const line of row.lines) {
    const part = el("div", `card-member${line.private ? " priv" : ""}`);
    const code = el("span", "card-code");

    code.append(...tokenNodes(line.tokens));

    if (line.private) {
      code.append(privateMark());
    }

    part.append(
      el("span", "card-line", line.line === null ? "" : `${line.line}`),
      code,
    );
    node.append(part);
  }

  if (row.hidden !== "") {
    node.append(el("div", "card-hidden", row.hidden));
  }

  hoverable(node, row.hover, actions);

  return node;
}

function rowNode(row: Row, actions: InspectorActions): HTMLElement {
  if (row.kind === "note") {
    return el("p", "", row.text);
  }

  if (row.kind === "none") {
    return el("div", "none", "None");
  }

  if (row.kind === "switch") {
    const node = el("button", "pswitch");

    node.type = "button";
    node.setAttribute("role", "switch");
    node.setAttribute("aria-checked", String(row.on));
    node.append(el("span", "track"), el("span", "", row.label));
    node.addEventListener("click", (event) => {
      event.stopPropagation();
      actions.setShowPrivate(!row.on);
    });

    return node;
  }

  if (row.kind === "card") {
    return cardNode(row, actions);
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

  if (row.kind === "filter") {
    const node = el("input", "ifilter");

    node.type = "text";
    node.value = row.value;
    node.placeholder = row.placeholder;
    node.autocomplete = "off";
    node.setAttribute("aria-label", "Filter");
    node.addEventListener("input", () => actions.setFilter(node.value));

    return node;
  }

  if (row.kind === "module") {
    const chevron = row.chevron;
    const toggle = chevron ? () => actions.toggleGroup(chevron.key) : null;
    const node = buildRow({
      label: row.label,
      state: row.state,
      bold: row.bold,
      disc: row.disc,
      chevron: chevron ? (chevron.open ? "open" : "closed") : undefined,
      detail: row.detail ?? undefined,
      onCheck: () =>
        nextCheck(row.state) === "takeOff"
          ? actions.takeOff(row.ids)
          : actions.putOnCanvas(row.ids),
      onName:
        toggle ?? (row.folder ? () => {} : () => actions.pickName(row.id)),
      onChevron: toggle ?? undefined,
    });

    node.classList.add(row.folder ? "folder" : "file");
    node.classList.toggle("indent", row.indent);
    node.title = row.title;
    node.dataset.id = row.id;

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

      const text = el("div", "ih-text");
      const name = el("b", "ih-name", content.header.title);

      name.title = content.header.title;
      text.append(name);

      if (content.header.muted !== "") {
        const folder = el("span", "muted ih-folder", content.header.muted);

        folder.title = content.header.muted;
        text.append(folder);
      }

      head.append(text);

      const target = content.header.target;

      if (target !== null) {
        head.append(
          iconButton("external-link", "Open in Editor (⌘⇧E)", "", () =>
            actions.openInEditor(target),
          ),
        );
      }

      close.type = "button";
      close.title = "Close the inspector";
      close.setAttribute("aria-label", "Close the inspector");
      close.append(icon("x"));
      close.addEventListener("click", (event) => {
        event.stopPropagation();
        actions.close();
      });
      head.append(close);

      const parts: HTMLElement[] = [head];

      if (content.tabs) {
        const tabs = el("div", "itabs");

        for (const tab of content.tabs) {
          const node = el("button", tab.active ? "on" : "");
          const counted = /^(.*?) (\d+)$/.exec(tab.label);

          if (counted) {
            node.append(`${counted[1]} `, el("span", "n", counted[2]));
          } else {
            node.textContent = tab.label;
          }

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

      const typing = panel.contains(document.activeElement)
        ? document.activeElement
        : null;
      const refocus = typing?.classList.contains("ifilter") === true;

      panel.replaceChildren(...parts);

      if (refocus) {
        const field = panel.querySelector<HTMLInputElement>(".ifilter");

        field?.focus();
        field?.setSelectionRange(field.value.length, field.value.length);
      }

      if (shown !== content.key) {
        panel.scrollTop = 0;
        shown = content.key;
      }
    },
  };
}
