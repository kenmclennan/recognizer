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
import type { SuiteRowModel, SuiteTone } from "./suite-results";

export type ScanPanelActions = {
  tick: (key: string, ticked: boolean) => void;
  tickSuite: (sensor: string, suite: string, ticked: boolean) => void;
  toggleFold: (sensor: string) => void;
  setOnlyView: (on: boolean) => void;
  setMode: (mode: ResultsMode) => void;
  run: () => void;
  stop: () => void;
  answerDescribe: (describe: boolean) => void;
  clearReport: (name: string) => void;
  copy: (text: string) => void;
  openLog: () => void;
  openRunLog: (path: string) => void;
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

function toneClass(tone: SuiteTone): string {
  return tone === "muted" ? "muted" : tone;
}

function foldButton(row: ScanRow, actions: ScanPanelActions): HTMLElement {
  if (row.fold === null) {
    return el("span", "scan-fold-spacer");
  }

  const open = row.fold.open;
  const toggle = button("", "scan-fold", () => actions.toggleFold(row.key));

  toggle.append(icon("chevron-right", "scan-fold-icon"));
  toggle.classList.toggle("open", open);
  toggle.setAttribute("aria-expanded", String(open));
  toggle.setAttribute("aria-label", `${open ? "Hide" : "Show"} test suites`);
  toggle.title = `${open ? "Hide" : "Show"} test suites`;

  return toggle;
}

function rowNode(row: ScanRow, actions: ScanPanelActions): HTMLElement {
  const node = el("div", "scan-row");
  const label = el("label", "scan-row-label");
  const tick = el("input", "scan-tick");
  const state = el(
    "span",
    `scan-state ${row.tone === null ? stateTone(row.state) : toneClass(row.tone)}`,
  );
  const glyph = icon(
    row.text.icon,
    row.state.kind === "running" || row.text.icon === "loader"
      ? "scan-spin"
      : "scan-icon",
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
  tick.indeterminate = row.tick === "some";
  tick.disabled = row.disabled;
  tick.title = row.tickable ? "" : row.title;
  tick.setAttribute("aria-label", row.name);
  tick.addEventListener("change", () => actions.tick(row.key, tick.checked));
  label.append(tick, el("span", "scan-row-name", row.name));
  state.title = row.stateTitle;
  state.append(glyph, el("span", "scan-state-text", row.text.text));

  if (
    row.state.kind === "running" &&
    row.state.done !== null &&
    row.state.total !== null
  ) {
    state.append(miniBar(row.state.done, row.state.total));
  }

  if (row.state.kind === "failed" || row.why?.log === true) {
    state.append(button("log", "scan-log-link", () => actions.openLog()));
  }

  node.append(foldButton(row, actions), label, state);

  return node;
}

function suiteNode(
  suite: SuiteRowModel,
  actions: ScanPanelActions,
): HTMLElement {
  const node = el("div", "scan-row scan-suite");
  const label = el("label", "scan-row-label");
  const tick = el("input", "scan-tick");
  const state = el("span", `scan-state ${toneClass(suite.state.tone)}`);

  node.dataset.sensor = suite.sensor;
  node.dataset.suite = suite.name;
  node.dataset.state = suite.state.kind;
  tick.type = "checkbox";
  tick.checked = suite.ticked;
  tick.disabled = suite.disabled;
  tick.setAttribute("aria-label", `${suite.sensor} ${suite.name}`);
  tick.addEventListener("change", () =>
    actions.tickSuite(suite.sensor, suite.name, tick.checked),
  );
  label.append(
    tick,
    el("span", "scan-row-name", suite.name),
    el("span", "scan-lang", suite.tag),
  );
  state.title = suite.state.title;
  state.append(
    icon(
      suite.state.icon,
      suite.state.kind === "running" ? "scan-spin" : "scan-icon",
    ),
    el("span", "scan-state-text", suite.state.text),
  );
  node.append(label, state);

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
  const head = el("div", "summary-head");
  const when = el("span", "summary-when");

  node.dataset.shape = "run-card";
  node.dataset.phase = card.phase;

  if (card.when.icon !== null) {
    when.append(icon(card.when.icon, "summary-origin-icon"));
  }

  when.append(card.when.text);

  if (card.when.title !== undefined) {
    when.title = card.when.title;
  }

  head.append(el("span", "summary-head-text", card.head), when);
  text.append(head);

  if (card.line !== null || card.showLog !== null) {
    const line = el("div", "summary-line", card.line ?? "");

    if (card.lineTitle !== null) {
      line.title = card.lineTitle;
    }

    if (card.showLog !== null) {
      const log = card.showLog;

      line.append(
        " ",
        button("Show log", "scan-why-log", () => actions.openRunLog(log)),
      );
    }

    text.append(line);
  }

  if (card.gaps.length > 0) {
    const gaps = el("div", "preflight-gaps");

    gaps.append(...card.gaps.map((item) => gapNode(item)));
    text.append(gaps, ...card.help.map(helpNode));
  }

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
  const estimate = el("div", "scan-estimate");

  element.append(header, sub, list, controls, buttons, estimate);

  return {
    element,
    reveal(key) {
      element
        .querySelector<HTMLElement>(`[data-sensor="${CSS.escape(key)}"]`)
        ?.scrollIntoView({ block: "nearest" });
    },
    render(model) {
      sub.replaceChildren(model.header.text);

      if (model.estimate == null) {
        estimate.hidden = true;
        estimate.replaceChildren();
        estimate.removeAttribute("title");
      } else {
        estimate.hidden = false;
        estimate.textContent = model.estimate.text;
        estimate.title = model.estimate.title;
      }

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
          ...(row.fold?.open === true
            ? row.fold.suites.map((suite) => suiteNode(suite, actions))
            : []),
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
