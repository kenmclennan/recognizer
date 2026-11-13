import type {
  Classification,
  Impact,
  PickRow,
  Slot,
  TipLine,
} from "./commits-panel-model";
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
  impact: Impact;
  classification: Classification | null;
  tip: TipLine[] | null;
  titleTip: string[];
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
  hide: boolean;
  hidden: number;
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
  openLabel: string;
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
  setHide: (tab: CommitsTab, hide: boolean) => void;
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

type Cards = {
  show: (lines: TipLine[], event: PointerEvent) => void;
  move: (event: PointerEvent) => void;
  hide: () => void;
  showText: (lines: string[], event: PointerEvent) => void;
};

function impactNode(row: CommitRowView, cards: Cards): HTMLElement {
  const node = el("span", "commits-impact");
  const { tip } = row;

  node.append(
    el(
      "span",
      `commits-impact-count${row.impact.count === "no files" ? " zero" : ""}`,
      row.impact.count,
    ),
  );

  if (row.impact.squares.length > 0) {
    const marks = el("span", "commits-impact-marks");

    for (const square of row.impact.squares) {
      const mark = el("span", `commits-impact-mark ${square.tone}`);

      mark.append(
        el("i", `commits-impact-swatch ${square.tone}`),
        String(square.count),
      );
      marks.append(mark);
    }

    node.append(marks);
  }

  if (row.impact.elsewhere !== null) {
    node.append(el("span", "commits-impact-other", row.impact.elsewhere));
  }

  if (tip !== null) {
    node.addEventListener("pointerenter", (event) =>
      cards.show(tip, event as PointerEvent),
    );
    node.addEventListener("pointermove", (event) =>
      cards.move(event as PointerEvent),
    );
    node.addEventListener("pointerleave", () => cards.hide());
  }

  return node;
}

function rowNode(
  row: CommitRowView,
  actions: CommitsPanelActions,
  cards: Cards,
) {
  const node = button(
    "",
    `commits-row ${row.pick.kind}${row.slot === null ? "" : ` picked ${row.slot}`}${row.shaded ? " shaded" : ""}`,
    () => actions.pick(row.pick),
  );
  const text = el("span", "commits-row-text");
  const top = el("span", "commits-row-top");
  const title = el("span", "commits-row-title", row.title);

  title.addEventListener("pointerenter", (event) =>
    cards.showText(row.titleTip, event as PointerEvent),
  );
  title.addEventListener("pointermove", (event) =>
    cards.move(event as PointerEvent),
  );
  title.addEventListener("pointerleave", () => cards.hide());
  top.append(title);

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
  node.append(icon(row.icon), text, impactNode(row, cards));

  if (row.slot !== null) {
    node.append(
      el("span", "commits-picked", row.slot === "from" ? "From" : "To"),
    );
  }

  return node;
}

function buildCards(host: HTMLElement): Cards {
  const card = el("div", "commits-card");

  card.hidden = true;
  host.append(card);

  const place = (event: PointerEvent) => {
    const margin = 8;
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    const left = Math.min(
      Math.max(margin, event.clientX + 14),
      Math.max(margin, window.innerWidth - width - margin),
    );
    const top = Math.min(
      Math.max(margin, event.clientY + 14),
      Math.max(margin, window.innerHeight - height - margin),
    );

    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  };

  return {
    show(lines, event) {
      card.replaceChildren(
        ...lines.map((line) =>
          el(
            "div",
            `commits-card-${line.kind}${line.tone === undefined ? "" : ` ${line.tone}`}`,
            line.text,
          ),
        ),
      );
      card.hidden = false;
      place(event);
    },
    showText(lines, event) {
      card.replaceChildren(
        ...lines.map((line, index) =>
          el(
            "div",
            index === 0 ? "commits-card-heading" : "commits-card-file",
            line,
          ),
        ),
      );
      card.hidden = false;
      place(event);
    },
    move: place,
    hide() {
      card.hidden = true;
    },
  };
}

export function buildCommitsPanelView(
  actions: CommitsPanelActions,
): CommitsPanelView {
  const element = el("div", "commits-panel");
  const head = el("div", "commits-head");
  const list = el("div", "commits-list");
  const filter = el("div", "commits-filter");
  const tabs = el("div", "commits-tabs");
  const cards = buildCards(element);
  const hideBox = button("", "commits-hide", () =>
    actions.setHide(shownTab, hideBox.getAttribute("aria-checked") !== "true"),
  );
  const hideText = el(
    "span",
    "commits-hide-text",
    "Hide commits with no files on the canvas",
  );
  const hiddenCount = el("span", "commits-hidden");
  let shownTab: CommitsTab = "history";

  hideBox.setAttribute("role", "switch");
  filter.append(hideBox, hideText, hiddenCount);
  tabs.setAttribute("role", "tablist");
  element.append(head, tabs, filter, list);

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
      const open = button(model.openLabel, "commits-range-open", () =>
        actions.open(),
      );
      const save = button("Save as view", "commits-save", () => actions.save());
      const bar = el("div", "commits-open-bar");

      open.disabled = !model.canOpen;
      open.classList.toggle("ready", model.canOpen);
      save.hidden = !model.canSave;
      bar.append(open, save);
      head.replaceChildren(title, slots, bar);

      if (model.note !== null) {
        head.append(el("p", "commits-summary", model.note));
      }

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

      shownTab = model.tab;
      hideBox.setAttribute("aria-checked", String(shown.hide));
      hiddenCount.textContent =
        shown.hide && shown.hidden > 0 ? `${shown.hidden} hidden` : "";
      cards.hide();

      list.replaceChildren(
        ...(shown.loading
          ? [el("p", "commits-loading", "Loading")]
          : shown.notice !== null
            ? [el("p", "commits-notice", shown.notice)]
            : shown.rows.map((row) => rowNode(row, actions, cards))),
        ...(shown.note === null
          ? []
          : [el("p", "commits-list-note", shown.note)]),
      );
    },
  };
}
