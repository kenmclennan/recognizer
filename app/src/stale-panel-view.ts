import { button, el } from "./dom";
import { buildRow, type RowSpec } from "./row-view";

export type StalePanelModel = {
  missing: { path: string; rename: RowSpec | null }[];
  removed: string[];
  added: string[];
  newlyRelevant: RowSpec[];
  comparing: boolean;
  unavailable: string | null;
};

export type StalePanelActions = {
  update: () => void;
  leave: () => void;
};

export type StalePanel = {
  element: HTMLElement;
  render: (model: StalePanelModel | null) => void;
};

function section(title: string, ...children: HTMLElement[]): HTMLElement {
  const node = el("section", "stale-section");

  node.append(el("h4", "", title), ...children);

  return node;
}

export function buildStalePanel(actions: StalePanelActions): StalePanel {
  const element = el("div", "stale-panel");

  element.hidden = true;
  element.setAttribute("role", "region");
  element.setAttribute("aria-label", "This view is out of date");
  element.addEventListener("pointerdown", (event) => event.stopPropagation());

  return {
    element,
    render(model) {
      element.hidden = model === null;

      if (model === null) {
        element.replaceChildren();

        return;
      }

      const parts: HTMLElement[] = [
        el("p", "stale-title", "This view is out of date"),
      ];

      if (model.missing.length > 0) {
        parts.push(
          section(
            "Missing",
            ...model.missing.flatMap(({ path, rename }) => {
              const line = el("p", "stale-line", path);

              if (rename === null) {
                return [line];
              }

              line.append(el("span", "stale-rename", " renamed to"));

              return [line, buildRow(rename)];
            }),
          ),
        );
      }

      if (model.comparing) {
        parts.push(el("p", "stale-line", "Comparing with the commit..."));
      } else if (model.unavailable !== null) {
        parts.push(
          el("p", "stale-line", `Comparison unavailable: ${model.unavailable}`),
        );
      } else {
        if (model.removed.length + model.added.length > 0) {
          parts.push(
            section(
              "Changed relations",
              ...model.removed.map((line) =>
                el("p", "stale-line removed", `- ${line}`),
              ),
              ...model.added.map((line) =>
                el("p", "stale-line added", `+ ${line}`),
              ),
            ),
          );
        }

        if (model.newlyRelevant.length > 0) {
          parts.push(
            section("Newly relevant", ...model.newlyRelevant.map(buildRow)),
          );
        }
      }

      const buttons = el("div", "stale-actions");

      buttons.append(
        button("Update", "stale-update", actions.update),
        button("Leave as is", "stale-leave", actions.leave),
      );
      parts.push(buttons);
      element.replaceChildren(...parts);
    },
  };
}
