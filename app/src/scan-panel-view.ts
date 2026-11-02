import { button, el } from "./dom";
import type { ScanPanelModel, SensorRow } from "./scan-panel-model";

export type ScanPanelActions = {
  tickDescribe: (ticked: boolean) => void;
  tickSensors: (ticked: boolean) => void;
  tickSensor: (name: string, ticked: boolean) => void;
  run: () => void;
  stop: () => void;
};

export type ScanPanelView = {
  element: HTMLElement;
  render: (model: ScanPanelModel) => void;
  reveal: (name: string) => void;
};

function tickBox(
  label: string,
  checked: boolean,
  enabled: boolean,
  onChange: (ticked: boolean) => void,
): HTMLInputElement {
  const tick = el("input", "scan-tick");

  tick.type = "checkbox";
  tick.checked = checked;
  tick.disabled = !enabled;
  tick.setAttribute("aria-label", label);
  tick.addEventListener("change", () => onChange(tick.checked));

  return tick;
}

function sensorNode(row: SensorRow, actions: ScanPanelActions): HTMLElement {
  const node = el("div", `sensor-row ${row.kind}`);

  node.dataset.sensor = row.name;

  if (row.reason !== null) {
    node.title = row.reason;
  }

  if (row.tickable) {
    const tick = el("input", "sensor-tick");

    tick.type = "checkbox";
    tick.checked = row.ticked;
    tick.setAttribute("aria-label", `Select ${row.name}`);
    tick.addEventListener("change", () =>
      actions.tickSensor(row.name, tick.checked),
    );
    node.append(tick);
  }

  node.append(
    el("span", "sensor-name", row.name),
    el("span", `sensor-chip ${row.tone}`, row.chip),
  );

  if (row.extra !== null) {
    node.append(
      el("span", `sensor-chip extra ${row.extra.tone}`, row.extra.text),
    );
  }

  if (row.reason !== null) {
    node.append(el("div", "sensor-reason", row.reason));
  }

  return node;
}

export function buildScanPanelView(actions: ScanPanelActions): ScanPanelView {
  const element = el("div", "scan-panel");
  const header = el("div", "scan-header", "Scan");
  const head = el("div", "scan-head");
  const extract = el("div", "scan-block scan-extract");
  const describe = el("div", "scan-block scan-describe");
  const sensors = el("div", "scan-block scan-sensors");
  const buttons = el("div", "scan-buttons");

  element.append(header, head, extract, describe, sensors, buttons);

  return {
    element,
    reveal(name) {
      const row = element.querySelector<HTMLElement>(
        `[data-sensor="${CSS.escape(name)}"]`,
      );

      row?.scrollIntoView({ block: "nearest" });
    },
    render(model) {
      head.textContent =
        model.head === null
          ? "No scan yet"
          : [
              model.head.commit === null
                ? "Scanned"
                : `Scanned at ${model.head.commit}`,
              model.head.ageText,
            ].join(" - ");

      extract.replaceChildren(
        el("div", "scan-block-title", "Extract"),
        el(
          "div",
          "scan-block-line",
          [
            model.extract.languages.join(", "),
            `${model.extract.modules} modules`,
            `${model.extract.edges} edges`,
          ]
            .filter((part) => part !== "")
            .join(" · "),
        ),
        el("span", `sensor-chip ${model.extract.tone}`, model.extract.status),
      );

      const describeTitle = el("label", "scan-block-title");

      describeTitle.append(
        tickBox(
          "Describe",
          model.describe.ticked,
          model.describe.tickable,
          actions.tickDescribe,
        ),
        "Describe",
      );
      describe.replaceChildren(
        describeTitle,
        el(
          "div",
          "scan-block-line",
          model.describe.describer === null
            ? "no describer registered"
            : `${model.describe.counts.current} current · ${model.describe.counts.outOfDate} out of date · ${model.describe.counts.missing} missing`,
        ),
        el("div", "scan-block-line muted", model.describe.describer ?? ""),
      );

      const sensorsTitle = el("label", "scan-block-title");

      sensorsTitle.append(
        tickBox(
          "Sensors",
          model.sensors.ticked,
          model.sensors.tickable,
          actions.tickSensors,
        ),
        "Sensors",
      );
      sensors.replaceChildren(
        sensorsTitle,
        ...model.sensors.rows.map((row) => sensorNode(row, actions)),
      );

      const stopping = model.button.mode === "stop";
      const action = stopping
        ? button("Stop", "scan-stop-button", () => actions.stop())
        : button(`Scan: ${model.button.caption}`, "scan-run primary", () =>
            actions.run(),
          );

      action.title = model.button.flags;
      buttons.replaceChildren(action);
    },
  };
}
