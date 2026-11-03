import { button, el } from "./dom";
import type { ReportRow, ScanPanelModel, ScanRow } from "./scan-panel-model";

export type ScanPanelActions = {
  tick: (key: string, ticked: boolean) => void;
  run: () => void;
  stop: () => void;
  clearReport: (name: string) => void;
};

export type ScanPanelView = {
  element: HTMLElement;
  render: (model: ScanPanelModel) => void;
  reveal: (key: string) => void;
};

const SVG = "http://www.w3.org/2000/svg";

function spinnerIcon(): SVGElement {
  const svg = document.createElementNS(SVG, "svg");
  const arc = document.createElementNS(SVG, "path");

  svg.setAttribute("class", "scan-spin");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  arc.setAttribute("d", "M21 12a9 9 0 1 1-6.219-8.56");
  svg.append(arc);

  return svg;
}

function rowNode(row: ScanRow, actions: ScanPanelActions): HTMLElement {
  const node = el("div", "scan-row");
  const label = el("label", "scan-row-label");
  const tick = el("input", "scan-tick");
  const state = el("span", `scan-state ${row.state.tone}`);

  node.dataset.sensor = row.key;
  node.title = row.title;
  tick.type = "checkbox";
  tick.checked = row.ticked;
  tick.setAttribute("aria-label", row.name);
  tick.addEventListener("change", () => actions.tick(row.key, tick.checked));
  label.append(tick, row.name);

  if (row.state.tone === "run") {
    state.append(spinnerIcon());
  }

  state.append(row.state.text);
  node.append(label, state);

  return node;
}

function reportNode(row: ReportRow, actions: ScanPanelActions): HTMLElement {
  const node = el("div", "sensor-row reported");
  const clear = button("Clear", "sensor-clear", () =>
    actions.clearReport(row.name),
  );

  node.dataset.sensor = row.name;
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
  const sub = el("div", "scan-sub");
  const list = el("div", "scan-list");
  const buttons = el("div", "scan-buttons");

  element.append(header, sub, list, buttons);

  return {
    element,
    reveal(key) {
      element
        .querySelector<HTMLElement>(`[data-sensor="${CSS.escape(key)}"]`)
        ?.scrollIntoView({ block: "nearest" });
    },
    render(model) {
      sub.replaceChildren(model.header.text);

      if (model.header.changed !== null) {
        sub.append(" · ", el("span", "warn", model.header.changed));
      }

      list.replaceChildren(
        ...model.rows.map((row) => rowNode(row, actions)),
        ...model.reports.map((row) => reportNode(row, actions)),
      );

      if (model.pending) {
        buttons.replaceChildren();

        return;
      }

      const run = button("", "scan-run primary", () => actions.run());

      run.disabled = model.button.scanning;

      if (model.button.scanning) {
        run.append(spinnerIcon());
      }

      run.append(model.button.label);

      if (model.button.scanning) {
        buttons.replaceChildren(
          run,
          button("Stop", "scan-stop", () => actions.stop()),
        );

        return;
      }

      buttons.replaceChildren(run);
    },
  };
}
