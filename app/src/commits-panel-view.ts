import type {
  Classification,
  End,
  Impact,
  Mode,
  PickRow,
  TipLine,
} from "./commits-panel-model";
import type { Checks } from "./commits-parse";
import { button, el } from "./dom";
import { type IconName, icon } from "./icons";
import { spinner } from "./spinner-view";

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
  held: boolean;
  end: End | null;
  busy: boolean;
  shaded: boolean;
};

export type CommitsListView = {
  rows: CommitRowView[];
  notice: string | null;
  note: string | null;
  loading: boolean;
};

export type HistoryListView = CommitsListView & {
  hide: boolean;
  hidden: number;
};

export type EndView = {
  label: string;
  hint: string;
};

export type CommitsPanelModel = {
  branch: string | null;
  mode: Mode;
  first: EndView | null;
  last: EndView | null;
  next: End;
  guide: string;
  tab: CommitsTab;
  lists: Record<Exclude<CommitsTab, "history">, CommitsListView> & {
    history: HistoryListView;
  };
};

export type CommitsPanelActions = {
  pick: (row: PickRow) => void;
  setMode: (mode: Mode) => void;
  clearEnd: (end: End) => void;
  setTab: (tab: CommitsTab) => void;
  setHide: (hide: boolean) => void;
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

const END_NAMES: Record<End, string> = { first: "First", last: "Last" };

function endNode(
  which: End,
  view: EndView | null,
  active: boolean,
  actions: CommitsPanelActions,
): HTMLElement {
  const node = el("div", `commits-slot ${which}${active ? " active" : ""}`);
  const pick = el("div", "commits-slot-pick");
  const name = END_NAMES[which];

  pick.append(
    el("span", "commits-slot-name", name),
    el(
      "span",
      `commits-slot-value${view === null ? " empty" : ""}`,
      view?.label ?? "click a commit",
    ),
  );

  if (view !== null) {
    pick.append(el("span", "commits-slot-hint", view.hint));
  }

  node.append(pick);

  if (view !== null) {
    const clear = button("", "commits-slot-clear", () =>
      actions.clearEnd(which),
    );

    clear.append(icon("x"));
    clear.setAttribute("aria-label", `Clear ${name}`);
    node.append(clear);
  }

  return node;
}

function modeNode(mode: Mode, actions: CommitsPanelActions): HTMLElement {
  const node = el("div", "scan-run-mode seg commits-mode");
  const one = button("One commit", "commits-mode-one", () =>
    actions.setMode("one"),
  );
  const range = button("Range", "commits-mode-range", () =>
    actions.setMode("range"),
  );

  one.classList.toggle("on", mode === "one");
  range.classList.toggle("on", mode === "range");
  one.setAttribute("aria-pressed", String(mode === "one"));
  range.setAttribute("aria-pressed", String(mode === "range"));
  node.append(one, range);

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
    `commits-row ${row.pick.kind}${row.held ? " picked" : ""}${row.shaded ? " shaded" : ""}`,
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
  const lead = row.busy ? spinner("Loading") : icon(row.icon);

  if (row.busy) {
    lead.classList.add("commits-row-busy");
  }

  node.append(lead, text, impactNode(row, cards));

  if (row.end !== null) {
    node.append(el("span", "commits-picked", END_NAMES[row.end]));
  }

  return node;
}

const LOADING_TEXT: Record<CommitsTab, string> = {
  history: "Loading commits",
  branches: "Loading branches",
  prs: "Loading pull requests",
};

function loadingNode(tab: CommitsTab): HTMLElement {
  const holder = el("div", "commits-loading commits-loading-busy");

  holder.append(spinner("Loading"), el("span", "", LOADING_TEXT[tab]));

  return holder;
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
    actions.setHide(hideBox.getAttribute("aria-checked") !== "true"),
  );
  const hideText = el(
    "span",
    "commits-hide-text",
    "Hide commits with no files on the canvas",
  );
  const hiddenCount = el("span", "commits-hidden");

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

      const parts: HTMLElement[] = [title];

      if (model.tab === "history") {
        parts.push(modeNode(model.mode, actions));
      }

      const line = el("p", "commits-summary", model.guide);

      if (model.tab === "history" && model.mode === "range") {
        const slots = el("div", "commits-slots commits-range-slots");
        const wrap = el("div", "commits-range");

        slots.append(
          endNode("first", model.first, model.next === "first", actions),
          endNode("last", model.last, model.next === "last", actions),
        );
        wrap.append(slots, line);
        parts.push(wrap);
      } else {
        parts.push(line);
      }

      head.replaceChildren(...parts);

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
      const history = model.lists.history;

      filter.hidden = model.tab !== "history";
      hideBox.setAttribute("aria-checked", String(history.hide));
      hiddenCount.textContent =
        history.hide && history.hidden > 0 ? `${history.hidden} hidden` : "";
      cards.hide();

      list.replaceChildren(
        ...(shown.loading
          ? [loadingNode(model.tab)]
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
