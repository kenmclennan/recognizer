import { button, el } from "./dom";
import type { ViewRow, ViewsPanelModel } from "./views-panel-model";

export type ViewsPanelActions = {
  open: (name: string) => void;
  remove: (name: string) => void;
};

export type ViewsPanelView = {
  element: HTMLElement;
  render: (model: ViewsPanelModel | null, open: string | null) => void;
};

function chip(row: ViewRow): HTMLElement {
  return el("span", `view-chip ${row.kind}`, row.chip);
}

export function buildViewsPanelView(
  actions: ViewsPanelActions,
): ViewsPanelView {
  const element = el("div", "views-panel");

  return {
    element,
    render(model, open) {
      if (model === null) {
        element.replaceChildren(el("p", "views-empty", "No saved views"));

        return;
      }

      const parts: HTMLElement[] = [el("h3", "views-header", "Views")];

      if (model.live.length + model.stale.length + model.invalid.length === 0) {
        parts.push(el("p", "views-empty", "No saved views"));
      }

      for (const row of model.live) {
        const item = button(
          "",
          `views-row${row.name === open ? " current" : ""}`,
          () => actions.open(row.name),
        );

        item.dataset.view = row.name;
        item.append(
          el("span", "views-row-name", row.name),
          chip(row),
          el("span", "views-row-description", row.description),
          el(
            "span",
            "views-row-notes",
            row.notes === 0
              ? ""
              : `${row.notes} ${row.notes === 1 ? "note" : "notes"}`,
          ),
        );
        parts.push(item);
      }

      for (const entry of model.invalid) {
        const item = el("div", "views-row invalid");

        item.dataset.view = entry.name;
        item.append(
          el("span", "views-row-name", entry.name),
          el(
            "span",
            "views-row-description",
            `not a valid view: ${entry.problem}`,
          ),
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
          el("span", "views-row-name", row.name),
          chip(row),
          el("span", "views-row-description", row.description),
          ...row.reasons.map((reason) =>
            el("span", "views-row-reason", reason),
          ),
          remove,
        );
        parts.push(item);
      }

      element.replaceChildren(...parts);
    },
  };
}
