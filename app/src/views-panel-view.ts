import { button, el } from "./dom";
import { buildDetailsCard } from "./view-details-card-view";
import type { ViewRow, ViewsPanelModel } from "./views-panel-model";

export type ViewsPanelActions = {
  open: (name: string) => void;
  remove: (name: string) => void;
  saveDetails: (
    name: string,
    newName: string,
    title: string | null,
    description: string,
  ) => Promise<string | null>;
};

export type ViewsPanelView = {
  element: HTMLElement;
  render: (model: ViewsPanelModel | null, open: string | null) => void;
};

function lead(row: ViewRow): HTMLElement[] {
  return [
    el("span", "views-row-title", row.title ?? row.name),
    ...(row.title === null ? [] : [el("span", "views-row-name", row.name)]),
    el("span", "views-row-description", row.description),
  ];
}

export function buildViewsPanelView(
  actions: ViewsPanelActions,
): ViewsPanelView {
  const element = el("div", "views-panel");
  let editing: string | null = null;
  let last: { model: ViewsPanelModel | null; open: string | null } = {
    model: null,
    open: null,
  };
  const details = buildDetailsCard({
    idPrefix: "views-edit",
    commit: (name, title, description) =>
      editing === null
        ? Promise.resolve(null)
        : actions.saveDetails(editing, name, title, description),
    done: () => stopEditing(),
    cancel: () => stopEditing(),
  });

  function stopEditing() {
    if (editing === null) {
      return;
    }

    editing = null;
    draw(last.model, last.open);
  }

  function startEditing(row: ViewRow, model: ViewsPanelModel) {
    editing = row.name;
    details.open(
      {
        name: row.name,
        title: row.title,
        description: row.description,
        isNew: false,
      },
      namesExcept(model, row.name),
    );
    draw(model, last.open);
    details.focus();
  }

  function namesExcept(model: ViewsPanelModel, skip: string): string[] {
    return [
      ...model.live.map((row) => row.name),
      ...model.stale.map((row) => row.name),
      ...model.invalid.map((entry) => entry.name),
    ].filter((name) => name !== skip);
  }

  function draw(model: ViewsPanelModel | null, open: string | null) {
    last = { model, open };

    if (
      editing !== null &&
      (model === null || !model.live.some((row) => row.name === editing))
    ) {
      editing = null;
    }

    const active = document.activeElement;
    const focused =
      active instanceof HTMLElement && details.element.contains(active)
        ? active
        : null;

    paint(model, open);

    if (focused !== null && details.element.isConnected) {
      focused.focus();
    }
  }

  function paint(model: ViewsPanelModel | null, open: string | null) {
    if (model === null) {
      element.replaceChildren(el("p", "views-empty", "No saved views"));

      return;
    }

    if (editing !== null) {
      details.setNames(namesExcept(model, editing));
    }

    const parts: HTMLElement[] = [el("h3", "views-header", "Views")];

    if (model.live.length + model.stale.length + model.invalid.length === 0) {
      parts.push(el("p", "views-empty", "No saved views"));
    }

    for (const row of model.live) {
      if (row.name === editing) {
        parts.push(details.element);

        continue;
      }

      const item = el("div", `views-row${row.name === open ? " current" : ""}`);
      const openRow = () => {
        editing = null;
        actions.open(row.name);
      };
      const edit = button("Edit", "views-edit", () => startEditing(row, model));
      const remove = button("Delete", "views-delete", () => {
        editing = null;
        actions.remove(row.name);
      });

      item.dataset.view = row.name;
      item.tabIndex = 0;
      item.setAttribute("role", "button");
      item.addEventListener("click", openRow);
      item.addEventListener("keydown", (event) => {
        if (
          event.target === item &&
          (event.key === "Enter" || event.key === " ")
        ) {
          event.preventDefault();
          openRow();
        }
      });
      edit.setAttribute("aria-label", `Edit ${row.name}`);
      remove.setAttribute("aria-label", `Delete ${row.name}`);

      const foot = el("div", "views-row-foot");

      foot.append(el("span", "views-row-meta", row.meta ?? ""), edit, remove);
      item.append(...lead(row), foot);
      parts.push(item);
    }

    for (const entry of model.invalid) {
      const item = el("div", "views-row invalid");

      item.dataset.view = entry.name;
      item.append(
        el("span", "views-row-title", entry.name),
        el("span", "views-row-reason", `not a valid view: ${entry.problem}`),
      );
      parts.push(item);
    }

    if (model.stale.length > 0) {
      parts.push(el("h4", "views-stale-header", "Stale"));
    }

    for (const row of model.stale) {
      const item = el("div", "views-row stale");
      const remove = button("Delete", "views-delete", () =>
        actions.remove(row.name),
      );

      item.dataset.view = row.name;
      remove.setAttribute("aria-label", `Delete ${row.name}`);
      item.append(
        ...lead(row),
        ...row.reasons.map((reason) => el("span", "views-row-reason", reason)),
        remove,
      );
      parts.push(item);
    }

    element.replaceChildren(...parts);
  }

  return {
    element,
    render: draw,
  };
}
