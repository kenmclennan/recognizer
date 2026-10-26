import { el } from "./dom";
import type { Disc } from "./health";
import type {
  NameGroup,
  PickerGroup,
  PickerModel,
  PickerRow,
  PickerTab,
} from "./picker-model";

export type PickerActions = {
  toggle: (id: string) => void;
  toggleGroup: (key: string) => void;
  toggleCollapse: (key: string) => void;
  setTab: (tab: PickerTab) => void;
  setFilter: (text: string) => void;
  tickAll: () => void;
  add: () => void;
};

export type PickerView = {
  element: HTMLElement;
  render: (model: PickerModel | null) => void;
  focus: () => void;
};

export const CHEVRON_OPEN = "M6 9l6 6 6-6";
export const CHEVRON_CLOSED = "M9 6l6 6-6 6";
export const UNUSED_SHOWN = 8;

const SVG = "http://www.w3.org/2000/svg";

const TAB_LABELS: Record<PickerTab, string> = {
  module: "By module",
  name: "By name",
};

function chevron(open: boolean): SVGElement {
  const node = document.createElementNS(SVG, "svg");
  const path = document.createElementNS(SVG, "path");

  node.setAttribute("class", "picker-chevron");
  node.setAttribute("viewBox", "0 0 24 24");
  path.setAttribute("d", open ? CHEVRON_OPEN : CHEVRON_CLOSED);
  node.append(path);

  return node;
}

function tick(checked: boolean, disabled: boolean): HTMLInputElement {
  const node = el("input", "picker-tick");

  node.type = "checkbox";
  node.checked = checked;
  node.disabled = disabled;
  node.tabIndex = -1;

  return node;
}

export function buildPickerView(
  actions: PickerActions,
  disc: (id: string) => Disc,
): PickerView {
  const element = el("div", "picker");
  const title = el("div", "picker-title");
  const filter = el("input", "picker-filter");
  const tabs = el("div", "picker-tabs");
  const list = el("div", "picker-list");
  const foot = el("div", "picker-foot");

  element.hidden = true;
  filter.autocomplete = "off";
  filter.setAttribute("aria-label", "Filter");
  filter.addEventListener("input", () => actions.setFilter(filter.value));
  element.append(title, filter, tabs, list, foot);

  for (const type of [
    "pointerdown",
    "click",
    "contextmenu",
    "wheel",
  ] as const) {
    element.addEventListener(type, (event) => event.stopPropagation());
  }

  function rowNode(row: PickerRow, indent: boolean): HTMLElement {
    const node = el(
      "div",
      `picker-row${indent ? " indent" : ""}${row.onCanvas ? " done" : ""}`,
    );
    const detail = row.onCanvas
      ? "on canvas"
      : [row.namesText, row.inferred ? "inferred" : ""]
          .filter(Boolean)
          .join(" · ");
    const names = el(
      "span",
      `names${row.private ? " private" : row.inferred ? " inferred" : ""}`,
      detail,
    );

    node.title = row.id;
    node.dataset.id = row.id;
    node.append(
      tick(row.ticked, row.onCanvas),
      el("span", `disc disc-${disc(row.id)}`),
      el("span", "label", row.label),
      names,
    );
    node.addEventListener("click", () => actions.toggle(row.id));

    return node;
  }

  function groupNodes(group: PickerGroup): HTMLElement[] {
    if (!group.header) {
      return group.rows.map((row) => rowNode(row, false));
    }

    const header = el("div", "picker-group");
    const box = tick(group.allTicked, !group.selectable);

    box.setAttribute("aria-label", `All of ${group.label}`);
    box.addEventListener("click", (event) => {
      event.stopPropagation();
      actions.toggleGroup(group.key);
    });
    header.dataset.group = group.key;
    header.append(
      box,
      chevron(!group.collapsed),
      el("span", "", group.label),
      el("span", "count", String(group.count)),
    );
    header.addEventListener("click", () => actions.toggleCollapse(group.key));

    return [
      header,
      ...(group.collapsed ? [] : group.rows.map((row) => rowNode(row, true))),
    ];
  }

  function nameNodes(group: NameGroup): HTMLElement[] {
    const header = el("div", "picker-group names");

    header.append(
      el("span", "", group.name),
      el("span", "count", String(group.rows.length)),
    );

    return [header, ...group.rows.map((row) => rowNode(row, true))];
  }

  function renderTabs(model: PickerModel) {
    const offered = model.tabs();

    tabs.hidden = offered.length === 0;
    tabs.replaceChildren(
      ...offered.map((tab) => {
        const node = el(
          "button",
          model.tab() === tab ? "on" : "",
          TAB_LABELS[tab],
        );

        node.type = "button";
        node.addEventListener("click", () => actions.setTab(tab));

        return node;
      }),
    );
  }

  function renderList(model: PickerModel) {
    const scroll = list.scrollTop;
    const nodes: HTMLElement[] = [];

    if (model.tab() === "name") {
      nodes.push(...model.nameGroups().flatMap(nameNodes));

      const unused = model.unused();

      if (unused) {
        const more = unused.length - UNUSED_SHOWN;

        nodes.push(
          el(
            "div",
            "picker-group names unused",
            `Not used outside: ${unused.slice(0, UNUSED_SHOWN).join(", ")}${
              more > 0 ? ` and ${more} more` : ""
            }`,
          ),
        );
      }
    } else {
      nodes.push(...model.groups().flatMap(groupNodes));
    }

    list.replaceChildren(
      ...(nodes.length > 0
        ? nodes
        : [el("div", "picker-empty", "Nothing matches.")]),
    );
    list.scrollTop = scroll;
  }

  function renderFoot(model: PickerModel) {
    const state = model.footer();
    const add = el(
      "button",
      "picker-add",
      state.add > 0 ? `Add ${state.add}` : "Add",
    );

    add.type = "button";
    add.disabled = state.add === 0;
    add.addEventListener("click", () => actions.add());
    foot.replaceChildren(el("span", "", state.status));

    if (state.missing) {
      foot.append(el("span", "missing", state.missing));
    }

    foot.append(el("span", "spacer"));

    if (state.tickAll !== null) {
      const all = el("button", "picker-tick-all", `Tick all ${state.tickAll}`);

      all.type = "button";
      all.addEventListener("click", () => actions.tickAll());
      foot.append(all);
    }

    foot.append(add);
  }

  return {
    element,
    render(model) {
      element.hidden = model === null;

      if (model === null) {
        return;
      }

      title.textContent = model.title();
      filter.placeholder = model.placeholder();

      if (filter.value.trim().toLowerCase() !== model.filter()) {
        filter.value = model.filter();
      }

      renderTabs(model);
      renderList(model);
      renderFoot(model);
    },
    focus() {
      filter.focus();
    },
  };
}
