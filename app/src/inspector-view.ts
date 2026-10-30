import type { Token } from "recognizer";
import { isEditable } from "./canvas-keys";
import { el } from "./dom";
import { icon, iconButton } from "./icons";
import type {
  CardRow,
  Direction,
  InspectorContent,
  InspectorTab,
  ResponsibilityLineRow,
  Row,
} from "./inspector-model";
import { nextCheck } from "./row-model";
import { buildRow } from "./row-view";
import {
  type Crumb,
  rowKey,
  STRIP_WIDTH,
  type TrailKeyAction,
  type TrailLayout,
  trailKeyAction,
} from "./trail-model";

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
  describe: (id: string) => void;
  follow: (relation: Direction, id: string) => void;
  bringBack: (index: number) => void;
  putTrailOnCanvas: () => void;
  trailKey: (action: TrailKeyAction) => boolean;
};

export type TrailRender = {
  contents: InspectorContent[];
  layout: TrailLayout;
  active: number;
  crumbs: Crumb[];
  focused: (string | null)[];
  canPut: boolean;
};

export type InspectorView = {
  element: HTMLElement;
  render: (
    content: InspectorContent,
    open: boolean,
    trail?: TrailRender,
  ) => void;
};

export type PanelActions = (index: number) => InspectorActions;

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

const REASON_TEXT = {
  source: "source changed",
  describer: "describer changed",
  version: "version changed",
};

function responsibilityNode(
  row: ResponsibilityLineRow,
  actions: InspectorActions,
): HTMLElement {
  const node = el("div", `responsibility ${row.state.kind}`);

  if (row.state.kind === "missing") {
    node.append(el("span", "muted", "No responsibility line yet"));
  } else if (row.state.kind === "unknown") {
    node.append(
      el("span", "muted", `Responsibility unknown: ${row.state.reason}`),
    );
  } else {
    node.append(el("span", "line", row.state.line));
    node.append(el("span", "tag", "Generated"));

    if (row.state.kind === "out-of-date") {
      const button = el(
        "button",
        "describe",
        row.busy ? "Describing" : "Describe",
      );

      node.append(el("span", "tag stale", "Out of date"));
      button.type = "button";
      button.disabled = row.busy;
      button.title = row.state.reasons
        .map((reason) => REASON_TEXT[reason])
        .join(", ");
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        actions.describe(row.id);
      });
      node.append(button);
    }
  }

  if (row.failure !== null) {
    node.append(el("div", "finding warning", row.failure));
  }

  return node;
}

function rowNode(
  row: Row,
  actions: InspectorActions,
  focused: string | null,
): HTMLElement {
  if (row.kind === "note") {
    return el("p", "", row.text);
  }

  if (row.kind === "none") {
    return el("div", "none", "None");
  }

  if (row.kind === "responsibility") {
    return responsibilityNode(row, actions);
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

    const direction = row.follow;

    if (direction !== null) {
      const key = rowKey({ id: row.id, relation: direction });
      const wrap = el("div", "follow-wrap");
      const arrow = iconButton(
        "arrow-right",
        `Follow ${row.label} into its own panel`,
        "follow",
        () => actions.follow(direction, row.id),
      );

      node.dataset.follow = direction;
      node.classList.toggle("followed", row.followed);
      node.classList.toggle("kbd", focused === key);
      wrap.append(node, arrow);

      return wrap;
    }

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

type PanelView = {
  element: HTMLElement;
  render: (
    content: InspectorContent,
    actions: InspectorActions,
    focused: string | null,
    index: number,
  ) => void;
};

function buildPanelView(element: HTMLElement): PanelView {
  let shown: string | null = null;

  element.tabIndex = -1;

  return {
    element,
    render(content, actions, focused, index) {
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

      const label = index === 0 ? "Close the inspector" : "Close this panel";

      close.type = "button";
      close.title = label;
      close.setAttribute("aria-label", label);
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

      parts.push(...content.rows.map((row) => rowNode(row, actions, focused)));

      const typing = element.contains(document.activeElement)
        ? document.activeElement
        : null;
      const refocus = typing?.classList.contains("ifilter") === true;

      element.replaceChildren(...parts);

      if (refocus) {
        const field = element.querySelector<HTMLInputElement>(".ifilter");

        field?.focus();
        field?.setSelectionRange(field.value.length, field.value.length);
      }

      if (shown !== content.key) {
        element.scrollTop = 0;
        shown = content.key;
      }

      element
        .querySelector<HTMLElement>(".row.kbd")
        ?.scrollIntoView?.({ block: "nearest" });
    },
  };
}

function stripNode(
  index: number,
  label: string,
  actions: InspectorActions,
): HTMLElement {
  const node = el("button", "inspector-strip");

  node.type = "button";
  node.title = label;
  node.setAttribute("aria-label", `Bring back ${label}`);
  node.style.width = `${STRIP_WIDTH}px`;
  node.append(el("span", "strip-name", label));
  node.addEventListener("click", (event) => {
    event.stopPropagation();
    actions.bringBack(index);
  });

  return node;
}

function crumbsNode(trail: TrailRender, actions: InspectorActions) {
  const node = el("div", "inspector-crumbs");

  for (const crumb of trail.crumbs) {
    const button = el(
      "button",
      `crumb${crumb.index === trail.active ? " on" : ""}`,
    );

    button.type = "button";

    if (crumb.relation !== null) {
      button.append(el("span", "crumb-rel", crumb.relation), " ");
    }

    button.append(crumb.label);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      actions.bringBack(crumb.index);
    });
    node.append(button);
  }

  const route = iconButton(
    "route",
    "Put the trail on the canvas (P)",
    "crumb-route",
    () => actions.putTrailOnCanvas(),
  );

  route.disabled = !trail.canPut;
  node.append(route);

  return node;
}

export function buildInspectorView(
  actions: InspectorActions,
  forPanel: PanelActions = () => actions,
): InspectorView {
  const element = el("aside", "inspector");
  const rail = el("div", "inspector-rail");
  const first = el("div", "inspector-panel");
  const crumbsHost = el("div", "inspector-crumbs-host");
  const row = el("div", "inspector-trail");
  const opener = el("button", "ib");
  const panels: PanelView[] = [buildPanelView(first)];
  let wantFocus = false;

  const panelAt = (index: number) => {
    while (panels.length <= index) {
      panels.push(buildPanelView(el("div", "inspector-panel")));
    }

    return panels[index];
  };

  opener.type = "button";
  opener.title = "Open the inspector";
  opener.setAttribute("aria-label", "Open the inspector");
  opener.append(icon("panel-right"));
  opener.addEventListener("click", (event) => {
    event.stopPropagation();
    actions.open();
  });
  rail.append(opener);
  crumbsHost.hidden = true;
  row.hidden = true;
  element.append(rail, first, crumbsHost, row);

  element.addEventListener("keydown", (event) => {
    const action = trailKeyAction(event, isEditable(event.target));

    if (action === null) {
      return;
    }

    wantFocus = true;

    if (actions.trailKey(action)) {
      event.preventDefault();
      event.stopPropagation();
    }
  });

  const follows = (index: number): InspectorActions => {
    const own = forPanel(index);

    return {
      ...own,
      follow(relation, id) {
        wantFocus = true;
        own.follow(relation, id);
      },
    };
  };

  return {
    element,
    render(content, open, trail) {
      const multi = open && trail !== undefined && trail.contents.length > 1;

      element.classList.toggle("open", open);
      element.classList.toggle("trail", multi);
      rail.hidden = open;
      first.hidden = !open;
      crumbsHost.hidden = !multi;
      row.hidden = !multi;

      if (!open) {
        return;
      }

      const hadFocus = element.contains(document.activeElement) || wantFocus;

      wantFocus = false;

      if (!multi || trail === undefined) {
        if (first.parentElement !== element) {
          element.insertBefore(first, crumbsHost);
        }

        row.replaceChildren();
        crumbsHost.replaceChildren();

        panels[0].render(content, follows(0), trail?.focused[0] ?? null, 0);

        if (hadFocus && !first.contains(document.activeElement)) {
          first.focus({ preventScroll: true });
        }

        return;
      }

      const { layout } = trail;
      const nodes: HTMLElement[] = [];
      const strip = (index: number) =>
        stripNode(index, trail.crumbs[index].label, forPanel(index));

      nodes.push(...layout.strips.map(strip));

      for (const index of layout.shown) {
        const panel = panelAt(index);

        panel.render(
          trail.contents[index],
          follows(index),
          trail.focused[index],
          index,
        );
        panel.element.hidden = false;
        panel.element.classList.toggle("active", index === trail.active);
        nodes.push(panel.element);
      }

      nodes.push(...layout.later.map(strip));

      if (!layout.shown.includes(0)) {
        first.remove();
      }

      crumbsHost.replaceChildren(crumbsNode(trail, forPanel(0)));
      row.replaceChildren(...nodes);

      if (hadFocus) {
        panelAt(trail.active).element.focus({ preventScroll: true });
      }
    },
  };
}
