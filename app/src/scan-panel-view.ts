import { button, el } from "./dom";
import type {
  MeasureRow,
  ReportRow,
  ScanPanelModel,
  SensorRow,
} from "./scan-panel-model";

export type ScanPanelActions = {
  tickDescribe: (ticked: boolean) => void;
  tickMeasure: (ticked: boolean) => void;
  tickOverlay: (name: string, ticked: boolean) => void;
  tickSensors: (ticked: boolean) => void;
  tickSensor: (name: string, ticked: boolean) => void;
  run: () => void;
  stop: () => void;
  addSensor: (name: string) => void;
  removeSensor: (name: string) => void;
  clearReport: (name: string) => void;
};

export type ScanPanelView = {
  element: HTMLElement;
  render: (model: ScanPanelModel) => void;
  reveal: (name: string, kind?: "sensor" | "overlay") => void;
};

function addNode(
  model: ScanPanelModel["sensors"],
  actions: ScanPanelActions,
): HTMLElement[] {
  const nodes: HTMLElement[] = [];

  if (model.add.status === "unavailable") {
    nodes.push(
      el(
        "div",
        "sensor-add-unavailable",
        `Add a sensor is unavailable: ${model.add.reason}`,
      ),
    );
  }

  if (model.add.status === "list") {
    nodes.push(el("div", "scan-block-title sensor-add-title", "Add a sensor"));

    for (const item of model.add.items) {
      const row = el("div", "sensor-add");
      const add = button("Add", "sensor-add-button", () =>
        actions.addSensor(item.name),
      );

      row.dataset.shipped = item.name;
      add.disabled = !model.editable;
      add.setAttribute("aria-label", `Add ${item.name}`);
      row.append(
        el("span", "sensor-name", item.name),
        el("span", "sensor-add-line", item.line),
        add,
      );
      nodes.push(row);
    }
  }

  return nodes;
}

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

function measureNode(row: MeasureRow, actions: ScanPanelActions): HTMLElement {
  const node = el("div", "measure-row");

  node.dataset.overlay = row.name;

  if (row.reason !== null) {
    node.title = row.reason;
  }

  const tick = el("input", "sensor-tick");

  tick.type = "checkbox";
  tick.checked = row.ticked;
  tick.setAttribute("aria-label", `Select ${row.name}`);
  tick.addEventListener("change", () =>
    actions.tickOverlay(row.name, tick.checked),
  );
  node.append(
    tick,
    el("span", "sensor-name", row.name),
    el("span", `sensor-chip ${row.tone}`, row.chip),
    el("div", "scan-block-line muted measure-subline", row.subline),
  );

  if (row.reason !== null) {
    node.append(el("div", "sensor-reason", row.reason));
  }

  return node;
}

function sensorNode(
  row: SensorRow,
  actions: ScanPanelActions,
  editable: boolean,
): HTMLElement {
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

  if (row.removable) {
    const remove = button("Remove", "sensor-remove", () =>
      actions.removeSensor(row.name),
    );

    remove.disabled = !editable;
    remove.setAttribute("aria-label", `Remove ${row.name}`);
    node.append(remove);
  }

  if (row.reason !== null) {
    node.append(el("div", "sensor-reason", row.reason));
  }

  return node;
}

function reportNode(
  row: ReportRow,
  actions: ScanPanelActions,
  editable: boolean,
): HTMLElement {
  const node = el("div", "sensor-row reported");
  const clear = button("Clear", "sensor-clear", () =>
    actions.clearReport(row.name),
  );

  node.dataset.sensor = row.name;
  clear.disabled = !editable;
  clear.setAttribute("aria-label", `Clear ${row.name}`);
  node.append(
    el("span", "sensor-name", row.name),
    el("span", `sensor-chip ${row.stale ? "amber" : "muted"}`, row.chip),
    el("span", "sensor-commit", row.commit),
    clear,
  );

  return node;
}

export function buildScanPanelView(actions: ScanPanelActions): ScanPanelView {
  const element = el("div", "scan-panel");
  const header = el("div", "scan-header", "Scan");
  const head = el("div", "scan-head");
  const extract = el("div", "scan-block scan-extract");
  const describe = el("div", "scan-block scan-describe");
  const measure = el("div", "scan-block scan-measure");
  const sensors = el("div", "scan-block scan-sensors");
  const buttons = el("div", "scan-buttons");

  element.append(header, head, extract, describe, measure, sensors, buttons);

  return {
    element,
    reveal(name, kind = "sensor") {
      const row = element.querySelector<HTMLElement>(
        `[data-${kind}="${CSS.escape(name)}"]`,
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

      const measureTitle = el("label", "scan-block-title");

      measureTitle.append(
        tickBox(
          "Measure",
          model.measure.ticked,
          model.measure.tickable,
          actions.tickMeasure,
        ),
        "Measure",
      );
      measure.replaceChildren(
        measureTitle,
        ...(model.measure.rows.length === 0
          ? [el("div", "scan-block-line", "no overlays registered")]
          : model.measure.rows.map((row) => measureNode(row, actions))),
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
        ...model.sensors.rows.map((row) =>
          sensorNode(row, actions, model.sensors.editable),
        ),
        ...model.sensors.reports.map((row) =>
          reportNode(row, actions, model.sensors.editable),
        ),
        ...addNode(model.sensors, actions),
      );

      const stopping = model.button.mode === "stop";
      const action = stopping
        ? button("Stop", "scan-stop-button", () => actions.stop())
        : button(model.button.label, "scan-run primary", () => actions.run());

      action.title = model.button.flags;
      buttons.replaceChildren(
        action,
        ...(stopping ? [] : [el("span", "scan-summary", model.button.summary)]),
      );
    },
  };
}
