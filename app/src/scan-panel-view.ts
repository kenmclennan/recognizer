import { button, el } from "./dom";
import { attachHoverTip } from "./hover-tip";
import type { FreshnessReport, ResultsMode } from "./scan-freshness";
import type { ReportRow, ScanPanelModel, ScanRow } from "./scan-panel-model";

export type ScanPanelActions = {
  tick: (key: string, ticked: boolean) => void;
  setOnlyView: (on: boolean) => void;
  setMode: (mode: ResultsMode) => void;
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
  node.dataset.tip = row.title;

  attachHoverTip(node, "scan-tip", (tip) => {
    tip.textContent = row.title;
  });
  tick.type = "checkbox";
  tick.checked = row.ticked;
  tick.disabled = row.disabled;
  tick.setAttribute("aria-label", row.name);
  tick.addEventListener("change", () => actions.tick(row.key, tick.checked));
  label.append(tick, row.name);

  if (row.state.tone === "run") {
    state.append(spinnerIcon());
  }

  state.append(row.state.text);

  if (row.note !== null) {
    state.append(el("small", "scan-note", row.note));
  }

  node.append(label, state);

  return node;
}

function scopeNode(
  scope: NonNullable<ScanPanelModel["scope"]>,
  actions: ScanPanelActions,
): HTMLElement {
  const node = el("div", "scan-scope seg");
  const canvas = button(scope.caption, "scan-scope-canvas", () =>
    actions.setOnlyView(true),
  );
  const all = button("Whole repository", "scan-scope-all", () =>
    actions.setOnlyView(false),
  );

  canvas.setAttribute("aria-pressed", String(scope.on));
  all.setAttribute("aria-pressed", String(!scope.on));
  canvas.classList.toggle("on", scope.on);
  all.classList.toggle("on", !scope.on);
  canvas.disabled = scope.disabled;
  all.disabled = scope.disabled;
  node.append(canvas, all);

  return node;
}

function modeNode(
  mode: ScanPanelModel["mode"],
  actions: ScanPanelActions,
): HTMLElement {
  const node = el("div", "scan-mode");
  const group = el("div", "scan-mode-switch seg");
  const bring = button("Bring up to date", "scan-mode-bring", () =>
    actions.setMode("bring"),
  );
  const rescan = button("Rescan from scratch", "scan-mode-rescan", () =>
    actions.setMode("rescan"),
  );
  const on = mode.value === "bring";

  bring.setAttribute("aria-pressed", String(on));
  rescan.setAttribute("aria-pressed", String(!on));
  bring.classList.toggle("on", on);
  rescan.classList.toggle("on", !on);
  bring.disabled = mode.disabled;
  rescan.disabled = mode.disabled;
  group.append(bring, rescan);
  node.append(el("div", "scan-mode-title", "Results"), group);

  return node;
}

function freshnessNode(report: FreshnessReport): HTMLElement {
  const node = el("div", `scan-fresh ${report.complete ? "ok" : "warn"}`);

  node.append(
    el("div", "scan-fresh-head", report.head),
    el("div", "scan-fresh-body", report.body),
  );

  if (report.bar !== null) {
    const total = report.bar.current + report.bar.outOfDate;
    const meter = el("div", "scan-fresh-meter");
    const current = el("i", "scan-fresh-current");
    const out = el("i", "scan-fresh-out");

    current.style.width = `${(report.bar.current / total) * 100}%`;
    out.style.width = `${(report.bar.outOfDate / total) * 100}%`;
    meter.append(current, out);
    node.append(
      meter,
      el(
        "div",
        "scan-fresh-legend",
        `${report.bar.current} current · ${report.bar.outOfDate} out of date`,
      ),
    );
  }

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
        ...(model.report === null ? [] : [freshnessNode(model.report)]),
        ...(model.scope === null ? [] : [scopeNode(model.scope, actions)]),
        ...(model.pending ? [] : [modeNode(model.mode, actions)]),
        ...model.rows.map((row) => rowNode(row, actions)),
        ...model.reports.map((row) => reportNode(row, actions)),
      );

      if (model.pending) {
        buttons.replaceChildren();

        return;
      }

      const run = button("", "scan-run primary", () => actions.run());

      run.disabled = model.button.disabled;

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
