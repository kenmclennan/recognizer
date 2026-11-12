import type { PickRow, Slot } from "./commits-panel-model";
import type { Checks } from "./commits-parse";
import { button, el } from "./dom";
import { type IconName, icon } from "./icons";

export type CommitsTab = "history" | "branches" | "prs";

export type CommitRowView = {
  pick: PickRow;
  icon: IconName;
  title: string;
  meta: string;
  chips: string[];
  counts: string;
  badge: string | null;
  checks: Checks | null;
  slot: Slot | null;
  shaded: boolean;
};

export type CommitsListView = {
  rows: CommitRowView[];
  notice: string | null;
  note: string | null;
  loading: boolean;
};

export type SlotView = {
  label: string;
  hint: string | null;
};

export type CommitsPanelModel = {
  branch: string | null;
  active: Slot;
  from: SlotView | null;
  to: SlotView | null;
  note: string | null;
  canSwap: boolean;
  summary: string | null;
  canOpen: boolean;
  canSave: boolean;
  tab: CommitsTab;
  lists: Record<CommitsTab, CommitsListView>;
};

export type CommitsPanelActions = {
  pick: (row: PickRow) => void;
  selectSlot: (slot: Slot) => void;
  clearSlot: (slot: Slot) => void;
  swap: () => void;
  setTab: (tab: CommitsTab) => void;
  open: () => void;
  save: () => void;
};

export type CommitsPanelView = {
  element: HTMLElement;
  render: (model: CommitsPanelModel | null) => void;
};

const TABS: [CommitsTab, string][] = [
  ["history", "History"],
  ["branches", "Branches"],
  ["prs", "Pull requests"],
];

function slotNode(
  which: Slot,
  view: SlotView | null,
  active: boolean,
  actions: CommitsPanelActions,
): HTMLElement {
  const node = el("div", `commits-slot ${which}${active ? " active" : ""}`);
  const pick = button("", "commits-slot-pick", () => actions.selectSlot(which));
  const clear = button("", "commits-slot-clear", () =>
    actions.clearSlot(which),
  );

  pick.append(
    el("span", "commits-slot-name", which === "from" ? "From" : "To"),
    el(
      "span",
      `commits-slot-value${view === null ? " empty" : ""}`,
      view?.label ?? "pick below",
    ),
  );

  if (view?.hint) {
    pick.append(el("span", "commits-slot-hint", view.hint));
  }

  clear.append(icon("x"));
  clear.setAttribute("aria-label", `Clear ${which === "from" ? "From" : "To"}`);
  clear.hidden = view === null;
  node.append(pick, clear);

  return node;
}

function rowNode(row: CommitRowView, actions: CommitsPanelActions) {
  const node = button(
    "",
    `commits-row ${row.pick.kind}${row.slot === null ? "" : ` picked ${row.slot}`}${row.shaded ? " shaded" : ""}`,
    () => actions.pick(row.pick),
  );
  const text = el("span", "commits-row-text");
  const top = el("span", "commits-row-top");

  top.append(el("span", "commits-row-title", row.title));

  for (const chip of row.chips) {
    top.append(el("span", "commits-chip", chip));
  }

  if (row.badge !== null) {
    top.append(el("span", "commits-badge", row.badge));
  }

  if (row.checks !== null && row.checks !== "none") {
    top.append(el("span", `commits-checks ${row.checks}`, row.checks));
  }

  text.append(top, el("span", "commits-row-meta", row.meta));
  node.append(icon(row.icon), text, el("span", "commits-counts", row.counts));

  if (row.slot !== null) {
    node.append(
      el("span", "commits-picked", row.slot === "from" ? "From" : "To"),
    );
  }

  return node;
}

export function buildCommitsPanelView(
  actions: CommitsPanelActions,
): CommitsPanelView {
  const element = el("div", "commits-panel");
  const head = el("div", "commits-head");
  const list = el("div", "commits-list");
  const compare = el("div", "commits-compare");
  const tabs = el("div", "commits-tabs");

  tabs.setAttribute("role", "tablist");
  element.append(head, tabs, list, compare);

  return {
    element,
    render(model) {
      if (model === null) {
        return;
      }

      const title = el("h2", "commits-title", "Commits");

      if (model.branch !== null) {
        title.append(el("span", "commits-on-branch", model.branch));
      }

      const slots = el("div", "commits-slots");
      const swap = button("", "commits-swap", () => actions.swap());

      swap.append(icon("swap"));
      swap.setAttribute("aria-label", "Swap From and To");
      swap.disabled = !model.canSwap;
      slots.append(
        slotNode("from", model.from, model.active === "from", actions),
        swap,
        slotNode("to", model.to, model.active === "to", actions),
      );
      head.replaceChildren(title, slots);

      tabs.replaceChildren(
        ...TABS.map(([key, label]) => {
          const tab = button(
            label,
            `commits-tab${key === model.tab ? " on" : ""}`,
            () => actions.setTab(key),
          );

          tab.setAttribute("role", "tab");
          tab.setAttribute("aria-selected", String(key === model.tab));

          return tab;
        }),
      );

      const shown = model.lists[model.tab];

      list.replaceChildren(
        ...(shown.loading
          ? [el("p", "commits-loading", "Loading")]
          : shown.notice !== null
            ? [el("p", "commits-notice", shown.notice)]
            : shown.rows.map((row) => rowNode(row, actions))),
        ...(shown.note === null
          ? []
          : [el("p", "commits-list-note", shown.note)]),
      );

      const open = button("Open", "commits-range-open", () => actions.open());
      const save = button("Save as view", "commits-save", () => actions.save());
      const summary = el(
        "p",
        "commits-summary",
        model.note ?? model.summary ?? "Pick a commit, branch or pull request.",
      );

      open.disabled = !model.canOpen;
      save.hidden = !model.canSave;
      compare.replaceChildren(summary, open, save);
    },
  };
}
