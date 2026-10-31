import { button, el } from "./dom";
import type { PanelModel } from "./sensors-panel-model";

export type SensorsPanelActions = {
  tick: (name: string, ticked: boolean) => void;
  runSelected: () => void;
  runAll: () => void;
};

export type SensorsPanelView = {
  element: HTMLElement;
  render: (model: PanelModel) => void;
};

export function buildSensorsPanelView(
  actions: SensorsPanelActions,
): SensorsPanelView {
  const element = el("div", "sensors-panel");
  const header = el("div", "sensors-header", "Sensors");
  const scan = el("div", "sensors-scan");
  const list = el("div", "sensor-rows");
  const runSelected = button("Run selected", "sensors-run-selected", () =>
    actions.runSelected(),
  );
  const runAll = button("Run all", "sensors-run-all", () => actions.runAll());
  const buttons = el("div", "sensors-buttons");
  const note = el("p", "sensors-note", "A run writes the findings file.");

  buttons.append(runSelected, runAll);
  element.append(header, scan, list, buttons, note);

  return {
    element,
    render(model) {
      scan.textContent =
        model.scan === null
          ? "No scan yet"
          : [
              model.scan.commit === null
                ? "Scanned"
                : `Scanned at ${model.scan.commit}`,
              model.scan.ageText,
              model.scan.languages.join(", "),
            ]
              .filter((part) => part !== "")
              .join(" - ");
      list.replaceChildren(
        ...model.rows.map((row) => {
          const node = el("div", `sensor-row ${row.kind}`);
          const chip = el("span", `sensor-chip ${row.tone}`, row.chip);

          if (row.reason !== null) {
            node.title = row.reason;
          }

          if (row.tickable) {
            const tick = el("input", "sensor-tick");

            tick.type = "checkbox";
            tick.checked = row.ticked;
            tick.setAttribute("aria-label", `Select ${row.name}`);
            tick.addEventListener("change", () =>
              actions.tick(row.name, tick.checked),
            );
            node.append(tick);
          }

          node.append(el("span", "sensor-name", row.name), chip);

          return node;
        }),
      );
      runSelected.disabled = !model.buttons.runSelected;
      runAll.disabled = !model.buttons.runAll;
    },
  };
}
