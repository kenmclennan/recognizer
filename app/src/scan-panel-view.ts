import { button, el } from "./dom";
import type { ResultState, Summary } from "./freshness-model";
import { attachHoverTip } from "./hover-tip";
import { icon } from "./icons";
import type { ResultsMode } from "./scan-freshness";
import {
  DESCRIBE_KEY,
  type ReportRow,
  type ScanPanelModel,
  type ScanRow,
} from "./scan-panel-model";
import type { GapItem, HelpLine, RunCard } from "./scan-run-model";
import type { ScanWhy } from "./scan-why";

export type ScanPanelActions = {
  tick: (key: string, ticked: boolean) => void;
  setOnlyView: (on: boolean) => void;
  setMode: (mode: ResultsMode) => void;
  run: () => void;
  stop: () => void;
  answerDescribe: (describe: boolean) => void;
  clearReport: (name: string) => void;
  copy: (text: string) => void;
  openLog: () => void;
  openRunLog: (log: string) => void;
};

export type ScanPanelView = {
  element: HTMLElement;
  render: (model: ScanPanelModel) => void;
  reveal: (key: string) => void;
};

function stateTone(state: ResultState): string {
  switch (state.kind) {
    case "current":
      return "ok";
    case "out-of-date":
      return "warn";
    case "never-run":
      return "muted";
    case "failed":
      return "bad";
    case "running":
      return "run";
  }
}

function miniBar(done: number, total: number): HTMLElement {
  const track = el("span", "scan-bar");
  const fill = el("i", "scan-bar-fill");

  fill.style.width = `${total > 0 ? Math.min(100, (done / total) * 100) : 0}%`;
  track.append(fill);

  return track;
}

function rowNode(row: ScanRow, actions: ScanPanelActions): HTMLElement {
  const node = el("div", "scan-row");
  const label = el("label", "scan-row-label");
  const tick = el("input", "scan-tick");
  const state = el("span", `scan-state ${stateTone(row.state)}`);
  const glyph = icon(
    row.text.icon,
    row.state.kind === "running" ? "scan-spin" : "scan-icon",
  );

  node.dataset.sensor = row.key;
  node.dataset.state = row.state.kind;
  node.dataset.tip = row.title;

  attachHoverTip(
    node,
    "scan-tip",
    (tip) => {
      tip.textContent = row.title;
    },
    row.key,
  );
  tick.type = "checkbox";
  tick.checked = row.ticked;
  tick.disabled = row.disabled;
  tick.title = row.tickable ? "" : row.title;
  tick.setAttribute("aria-label", row.name);
  tick.addEventListener("change", () => actions.tick(row.key, tick.checked));
  label.append(tick, row.name);
  state.append(glyph, el("span", "scan-state-text", row.text.text));

  if (
    row.state.kind === "running" &&
    row.state.done !== null &&
    row.state.total !== null
  ) {
    state.append(miniBar(row.state.done, row.state.total));
  }

  if (row.state.kind === "failed") {
    state.append(button("log", "scan-log-link", () => actions.openLog()));
  }

  if (row.note !== null) {
    state.append(el("small", "scan-note", row.note));
  }

  node.append(label, state);

  if (row.why !== null) {
    node.classList.add("has-why");
    node.append(whyNode(row.why, actions));
  }

  return node;
}

function whyNode(why: ScanWhy, actions: ScanPanelActions): HTMLElement {
  const node = el("div", "scan-why");

  node.append(
    ...why.segments.map((segment) =>
      segment.code ? el("code", "", segment.text) : segment.text,
    ),
  );

  if (why.copy !== null) {
    const text = why.copy;

    node.append(
      " ",
      button("Copy", "scan-why-copy", () => actions.copy(text)),
    );
  }

  if (why.log) {
    const link = button("Show log", "scan-why-log", () => actions.openLog());

    node.append(" ", link);
  }

  return node;
}

function confirmNode(
  confirm: NonNullable<ScanPanelModel["confirm"]>,
  actions: ScanPanelActions,
): HTMLElement {
  const node = el("div", "scan-confirm");
  const buttons = el("div", "scan-confirm-buttons");

  buttons.append(
    button("Describe", "scan-confirm-describe primary", () =>
      actions.answerDescribe(true),
    ),
    button("Skip describing", "scan-confirm-skip", () =>
      actions.answerDescribe(false),
    ),
  );
  node.setAttribute("role", "alertdialog");
  node.append(
    el("div", "scan-confirm-head", confirm.heading),
    el("div", "scan-confirm-model", confirm.model),
    el("div", "scan-confirm-estimate", confirm.estimate),
    buttons,
  );

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
  canvas.disabled = scope.disabled || scope.canvasEmpty;

  if (scope.canvasEmpty) {
    canvas.title = "The canvas is empty.";
  }

  all.disabled = scope.disabled;
  node.append(canvas, all);

  return node;
}

function modeNode(
  mode: ScanPanelModel["mode"],
  actions: ScanPanelActions,
): HTMLElement {
  const node = el("div", "scan-run-mode seg");
  const incremental = button("Incremental", "scan-run-mode-incremental", () =>
    actions.setMode("bring"),
  );
  const full = button("Full", "scan-run-mode-full", () =>
    actions.setMode("rescan"),
  );
  const rescan = mode.value === "rescan";

  incremental.setAttribute("aria-pressed", String(!rescan));
  full.setAttribute("aria-pressed", String(rescan));
  incremental.classList.toggle("on", !rescan);
  full.classList.toggle("on", rescan);
  incremental.disabled = mode.disabled;
  full.disabled = mode.disabled;
  node.append(incremental, full);

  return node;
}

function summaryNode(summary: Summary): HTMLElement {
  const node = el("div", `summary ${summary.tone}`);
  const text = el("div", "summary-text");

  node.dataset.shape = summary.shape;
  text.append(
    el("div", "summary-head", summary.head),
    el("div", "summary-line", summary.line),
  );

  if (summary.bar !== null) {
    const track = el("div", "summary-bar");
    const fill = el("i", "summary-bar-fill");
    const { done, total } = summary.bar;

    fill.style.width = `${total > 0 ? Math.min(100, (done / total) * 100) : 0}%`;
    track.append(fill);
    text.append(track);
  }

  node.append(
    icon(summary.icon, summary.tone === "run" ? "scan-spin" : "summary-icon"),
    text,
  );

  return node;
}

function gapNode(item: GapItem): HTMLElement {
  const node = el("div", "preflight-gap");

  node.dataset.gap = item.id;
  node.append(
    el("div", "preflight-gap-line", item.line),
    el("div", "preflight-gap-where", item.where),
  );

  return node;
}

function helpNode(line: HelpLine): HTMLElement {
  const node = el("div", "preflight-help");

  node.dataset.sensor = line.sensor;
  node.append(
    `${line.text} `,
    el("code", "preflight-help-command", line.command),
  );

  return node;
}

function cardNode(card: RunCard, actions: ScanPanelActions): HTMLElement {
  const node = el("div", `summary ${card.tone}`);
  const text = el("div", "summary-text");
  const line = el("div", "summary-line", card.line);

  node.dataset.shape = "run-card";
  node.dataset.phase = card.phase;

  if (card.showLog !== null) {
    const log = card.showLog;

    line.append(
      " ",
      button("Show log", "scan-why-log", () => actions.openRunLog(log)),
    );
  }

  text.append(el("div", "summary-head", card.head), line);

  if (card.second !== null) {
    text.append(el("div", "summary-line", card.second));
  }

  if (card.gaps.length > 0) {
    const gaps = el("div", "preflight-gaps");

    gaps.append(...card.gaps.map((item) => gapNode(item)));
    text.append(gaps, ...card.help.map(helpNode));
  }

  const origin = el("div", "summary-origin");

  if (card.origin.icon !== null) {
    origin.append(icon(card.origin.icon, "summary-origin-icon"));
  }

  origin.append(card.origin.text);
  text.append(origin);

  node.append(
    icon(card.icon, card.tone === "run" ? "scan-spin" : "summary-icon"),
    text,
  );

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
  const controls = el("div", "scan-controls");
  const buttons = el("div", "scan-buttons");

  element.append(header, sub, list, controls, buttons);

  return {
    element,
    reveal(key) {
      element
        .querySelector<HTMLElement>(`[data-sensor="${CSS.escape(key)}"]`)
        ?.scrollIntoView({ block: "nearest" });
    },
    render(model) {
      sub.replaceChildren(model.header.text);

      if (model.header.moved !== null) {
        sub.append(" · ", el("span", "warn", model.header.moved));
      }

      list.replaceChildren(
        ...(model.pending
          ? []
          : [
              model.run == null
                ? summaryNode(model.summary)
                : cardNode(model.run.card, actions),
            ]),
        ...model.rows.flatMap((row) => [
          rowNode(row, actions),
          ...(row.key === DESCRIBE_KEY && model.confirm !== null
            ? [confirmNode(model.confirm, actions)]
            : []),
        ]),
        ...model.reports.map((row) => reportNode(row, actions)),
      );

      controls.replaceChildren(
        ...(model.scope === null ? [] : [scopeNode(model.scope, actions)]),
        ...(model.pending ? [] : [modeNode(model.mode, actions)]),
      );

      if (model.pending) {
        buttons.replaceChildren();

        return;
      }

      if (model.button.stop) {
        buttons.replaceChildren(
          button(model.button.label, "scan-stop primary", () => actions.stop()),
        );

        return;
      }

      const run = button(model.button.label, "scan-run primary", () =>
        actions.run(),
      );

      run.disabled = model.button.disabled;

      if (model.button.scanning) {
        run.prepend(icon("loader", "scan-spin"));
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
