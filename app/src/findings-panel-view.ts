import { button, el } from "./dom";
import type { FindingFilter, FindingGroup } from "./findings-order";
import {
  groupCount,
  kindLabel,
  sameFilter,
  severityLabel,
} from "./findings-order";

export type FindingsPanelModel = {
  chips: { label: string; count: number; filter: FindingFilter }[];
  filter: FindingFilter;
  stale: string | null;
  groups: FindingGroup[];
  active: string | null;
  empty: string | null;
};

export type FindingsPanelActions = {
  select: (id: string) => void;
  filter: (filter: FindingFilter) => void;
  openSensors: () => void;
};

export type FindingsPanelView = {
  element: HTMLElement;
  render: (model: FindingsPanelModel) => void;
};

function split(path: string): { name: string; folder: string } {
  const at = path.lastIndexOf("/");

  return at === -1
    ? { name: path, folder: "" }
    : { name: path.slice(at + 1), folder: path.slice(0, at) };
}

export function buildFindingsPanelView(
  actions: FindingsPanelActions,
): FindingsPanelView {
  const element = el("div", "findings-panel");
  const header = el("div", "findings-header", "Findings");
  const chipBar = el("div", "findings-chips");
  const stale = button("", "findings-stale", () => actions.openSensors());
  const list = el("div", "finding-rows");
  const empty = el("p", "findings-empty");

  element.append(header, chipBar, stale, list, empty);

  return {
    element,
    render(model) {
      chipBar.replaceChildren(
        ...model.chips.map((chip) => {
          const node = button(
            `${chip.label} ${chip.count}`,
            sameFilter(chip.filter, model.filter)
              ? "findings-chip on"
              : "findings-chip",
            () => actions.filter(chip.filter),
          );

          node.setAttribute(
            "aria-pressed",
            String(sameFilter(chip.filter, model.filter)),
          );

          return node;
        }),
      );
      stale.textContent = model.stale ?? "";
      stale.hidden = model.stale === null;
      empty.textContent = model.empty ?? "";
      empty.hidden = model.empty === null;
      list.replaceChildren(
        ...model.groups.map((group) => {
          const block = el("div", `finding-severity ${group.severity}`);

          block.append(
            el(
              "div",
              "finding-severity-title",
              `${severityLabel(group.severity)} ${groupCount(group)}`,
            ),
          );

          for (const kind of group.kinds) {
            const section = el("div", `finding-group ${group.severity}`);

            section.append(
              el(
                "div",
                "finding-group-title",
                `${kindLabel(kind.kind)} ${kind.rows.length}`,
              ),
            );

            for (const row of kind.rows) {
              const place = split(row.module);
              const node = button(
                "",
                row.id === model.active
                  ? `finding-row ${row.severity} active`
                  : `finding-row ${row.severity}`,
                () => actions.select(row.id),
              );

              node.dataset.id = row.id;
              node.append(
                el("span", `finding-mark ${row.severity}`),
                el("span", "finding-file", place.name),
                el("span", "finding-folder", place.folder),
                el("span", "finding-summary", row.summary),
                el("span", "finding-principle", row.principle),
                el("span", "finding-sensor", row.sensor),
              );
              section.append(node);
            }

            block.append(section);
          }

          return block;
        }),
      );
    },
  };
}
