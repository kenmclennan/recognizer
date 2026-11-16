import { button, el } from "./dom";
import { icon } from "./icons";
import type { OpenModel, OpenProgress, OpenRow } from "./scan-open-model";

export type OpenActions = {
  stop: () => void;
  again: () => void;
  openLog: () => void;
};

export type OpenView = {
  render: (model: OpenModel) => void;
  remove: () => void;
};

function stateNode(row: OpenRow, actions: OpenActions): HTMLElement {
  const state = el("span", `scan-state ${stateClass(row)}`);

  if (row.state === "running") {
    state.append(icon("loader", "scan-spin"));
  } else if (row.state === "done") {
    state.append(icon("check", "scan-icon"));
  } else if (row.state === "failed") {
    state.append(icon("x", "scan-icon"));
  }

  state.append(row.text === "" ? "" : ` ${row.text}`);

  if (row.state === "failed" && row.logLink) {
    state.append(" ", button("log", "scan-log-link", actions.openLog));
  }

  return state;
}

function stateClass(row: OpenRow): string {
  switch (row.state) {
    case "running":
      return "run";
    case "done":
      return "ok";
    case "failed":
      return "bad";
    case "waiting":
      return "muted";
  }
}

function rowNode(row: OpenRow, actions: OpenActions): HTMLElement {
  const node = el("div", "scan-row");

  node.dataset.language = row.key;
  node.dataset.state = row.state;
  node.append(el("span", "scan-row-name", row.name), stateNode(row, actions));

  return node;
}

function barNode(model: OpenProgress): HTMLElement {
  const bar = el("span", "fo-bar");
  const fill = el("span", "fo-fill");

  if (model.bar.kind === "determinate") {
    fill.style.width = `${Math.round(model.bar.fraction * 100)}%`;
  } else {
    bar.classList.add("indet");
  }

  bar.append(fill);

  return bar;
}

function progressNode(model: OpenProgress, actions: OpenActions): HTMLElement {
  const root = el("div", "fo");
  const meta = el("div", "fo-meta");
  const list = el("div", "fo-list");
  const foot = el("div", "fo-foot");

  root.setAttribute("role", "status");
  meta.append(
    el("span", "fo-counts", model.counts),
    el("span", "fo-left", model.timeLeft ?? ""),
  );
  list.append(...model.rows.map((row) => rowNode(row, actions)));
  foot.append(
    el("span", "fo-elapsed", `${model.elapsed} elapsed`),
    button("Stop", "primary fo-stop", actions.stop),
  );
  root.append(
    el("p", "fo-title", model.title),
    el("p", "fo-stage", model.stage),
    barNode(model),
    meta,
    list,
    foot,
  );

  return root;
}

function stoppedNode(
  model: Extract<OpenModel, { kind: "stopped" }>,
  actions: OpenActions,
): HTMLElement {
  const root = el("div", "fo");
  const again = el("div", "fo-again");

  again.append(button(model.again, "primary fo-again-button", actions.again));
  root.append(
    el("p", "fo-title", model.title),
    el("p", "fo-msg", model.message),
    again,
  );

  return root;
}

export function showOpen(
  container: HTMLElement,
  actions: OpenActions,
): OpenView {
  const holder = el("div", "centered scan-busy");

  container.replaceChildren(holder);

  return {
    render: (model) => {
      holder.replaceChildren(
        model.kind === "progress"
          ? progressNode(model, actions)
          : stoppedNode(model, actions),
      );
    },
    remove: () => holder.remove(),
  };
}
