import type { Checks } from "@recognizer/core";
import type {
  Classification,
  End,
  Impact,
  Mode,
  PickRow,
  TipLine,
} from "./commits-panel-model";
import { filterLabel } from "./commits-panel-model";
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
  pinned: boolean;
  end: End | null;
  busy: boolean;
  shaded: boolean;
};

export type CommitsListView = {
  rows: CommitRowView[];
  notice: string | null;
  note: string | null;
  loading: boolean;
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
  pullsBusy: boolean;
  hide: boolean;
  lists: Record<CommitsTab, CommitsListView>;
};

export type CommitsPanelActions = {
  pick: (row: PickRow) => void;
  setMode: (mode: Mode) => void;
  clearEnd: (end: End) => void;
  setTab: (tab: CommitsTab) => void;
  setHide: (hide: boolean) => void;
  refreshPullRequests: () => void;
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

type Owner = { key: string; kind: "count" | "title"; trigger: HTMLElement };

type Cards = {
  show: (owner: Owner, lines: TipLine[], event: PointerEvent) => void;
  showText: (owner: Owner, lines: string[], event: PointerEvent) => void;
  move: (event: PointerEvent) => void;
  hide: () => void;
  sync: (
    resolve: (key: string, kind: Owner["kind"]) => TipLine[] | string[] | null,
  ) => void;
};

type RowEntry = {
  key: string;
  node: HTMLElement;
  title: HTMLElement;
  top: HTMLElement;
  meta: HTMLElement;
  text: HTMLElement;
  impact: HTMLElement;
  row: CommitRowView;
  signature: string;
  impactSignature: string;
};

const rowKey = (row: CommitRowView) => `${row.pick.kind}:${row.pick.ref}`;

function fillImpact(node: HTMLElement, row: CommitRowView) {
  const parts: HTMLElement[] = [
    el(
      "span",
      `commits-impact-count${row.impact.count === "no files" ? " zero" : ""}`,
      row.impact.count,
    ),
  ];

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

    parts.push(marks);
  }

  if (row.impact.elsewhere !== null) {
    parts.push(el("span", "commits-impact-other", row.impact.elsewhere));
  }

  node.replaceChildren(...parts);
}

function patchRow(entry: RowEntry, row: CommitRowView) {
  entry.row = row;

  const signature = JSON.stringify(row);

  if (signature === entry.signature) {
    return;
  }

  entry.signature = signature;
  entry.node.className = `commits-row ${row.pick.kind}${row.held ? " picked" : ""}${row.shaded ? " shaded" : ""}`;
  entry.title.textContent = row.title;

  const top: Node[] = [entry.title];

  for (const chip of row.chips) {
    top.push(el("span", "commits-chip", chip));
  }

  if (row.badge !== null) {
    top.push(el("span", "commits-badge", row.badge));
  }

  if (row.checks !== null && row.checks !== "none") {
    top.push(el("span", `commits-checks ${row.checks}`, row.checks));
  }

  entry.top.replaceChildren(...top);
  entry.meta.textContent = row.meta;

  const lead = row.busy ? spinner("Loading") : icon(row.icon);

  if (row.busy) {
    lead.classList.add("commits-row-busy");
  }

  const impactSignature = JSON.stringify(row.impact);

  if (impactSignature !== entry.impactSignature) {
    entry.impactSignature = impactSignature;
    fillImpact(entry.impact, row);
  }

  entry.node.replaceChildren(
    lead,
    entry.text,
    entry.impact,
    ...(row.end === null
      ? []
      : [el("span", "commits-picked", END_NAMES[row.end])]),
  );
}

function rowEntry(
  row: CommitRowView,
  actions: CommitsPanelActions,
  cards: Cards,
): RowEntry {
  const key = rowKey(row);
  const entry = {} as RowEntry;
  const node = button("", "commits-row", () => actions.pick(entry.row.pick));
  const text = el("span", "commits-row-text");
  const top = el("span", "commits-row-top");
  const title = el("span", "commits-row-title");
  const meta = el("span", "commits-row-meta");
  const impact = el("span", "commits-impact");

  text.append(top, meta);

  title.addEventListener("pointerenter", (event) =>
    cards.showText(
      { key, kind: "title", trigger: title },
      entry.row.titleTip,
      event as PointerEvent,
    ),
  );
  title.addEventListener("pointermove", (event) =>
    cards.move(event as PointerEvent),
  );
  title.addEventListener("pointerleave", () => cards.hide());

  impact.addEventListener("pointerenter", (event) => {
    if (entry.row.tip !== null) {
      cards.show(
        { key, kind: "count", trigger: impact },
        entry.row.tip,
        event as PointerEvent,
      );
    }
  });
  impact.addEventListener("pointermove", (event) => {
    if (entry.row.tip !== null) {
      cards.move(event as PointerEvent);
    }
  });
  impact.addEventListener("pointerleave", () => cards.hide());

  Object.assign(entry, {
    key,
    node,
    title,
    top,
    meta,
    text,
    impact,
    row,
    signature: "",
    impactSignature: "",
  });
  patchRow(entry, row);

  return entry;
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
  let owner: Owner | null = null;
  let shown = "";

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

  const draw = (kind: Owner["kind"], lines: TipLine[] | string[]) => {
    shown = JSON.stringify(lines);
    card.replaceChildren(
      ...(kind === "count"
        ? (lines as TipLine[]).map((line) =>
            el(
              "div",
              `commits-card-${line.kind}${line.tone === undefined ? "" : ` ${line.tone}`}`,
              line.text,
            ),
          )
        : (lines as string[]).map((line, index) =>
            el(
              "div",
              index === 0 ? "commits-card-heading" : "commits-card-file",
              line,
            ),
          )),
    );
  };

  const hide = () => {
    card.hidden = true;
    owner = null;
    shown = "";
  };

  const doc = host.ownerDocument;

  doc.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hide();
    }
  });
  doc.addEventListener("pointerdown", (event) => {
    if (owner !== null && !owner.trigger.contains(event.target as Node)) {
      hide();
    }
  });

  return {
    show(next, lines, event) {
      owner = next;
      draw("count", lines);
      card.hidden = false;
      place(event);
    },
    showText(next, lines, event) {
      owner = next;
      draw("title", lines);
      card.hidden = false;
      place(event);
    },
    move: place,
    hide,
    sync(resolve) {
      if (owner === null) {
        return;
      }

      const lines = resolve(owner.key, owner.kind);

      if (lines === null) {
        hide();

        return;
      }

      if (JSON.stringify(lines) !== shown) {
        draw(owner.kind, lines);
      }
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
  const hideText = button("", "commits-hide-text", () =>
    actions.setHide(hideBox.getAttribute("aria-checked") !== "true"),
  );
  const hiddenCount = el("span", "commits-hidden");
  let entries = new Map<string, RowEntry>();
  let lastTab: CommitsTab | null = null;

  hideBox.setAttribute("role", "switch");
  filter.append(hideBox, hideText, hiddenCount);
  tabs.setAttribute("role", "tablist");
  element.append(head, filter, tabs, list);

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
      } else if (model.tab === "prs") {
        const wrap = el("div", "commits-guide");
        const refresh = button("", "commits-refresh", () =>
          actions.refreshPullRequests(),
        );

        refresh.setAttribute("aria-label", "Refresh pull requests");
        refresh.title = "Refresh pull requests";
        refresh.disabled = model.pullsBusy;
        refresh.append(
          model.pullsBusy ? spinner("Loading") : icon("rotate-ccw"),
        );
        wrap.append(line, refresh);
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
      const label = filterLabel(model.tab);

      hideText.textContent = label;
      hideBox.setAttribute("aria-label", label);
      hideBox.setAttribute("aria-checked", String(model.hide));
      hiddenCount.textContent =
        model.hide && shown.hidden > 0 ? `${shown.hidden} hidden` : "";

      if (model.tab !== lastTab) {
        entries = new Map();
        lastTab = model.tab;
      }

      const live = new Map<string, RowEntry>();
      const showRows = !shown.loading && shown.notice === null;

      if (showRows) {
        for (const row of shown.rows) {
          const key = rowKey(row);
          const known = entries.get(key);

          if (known === undefined) {
            live.set(key, rowEntry(row, actions, cards));
          } else {
            patchRow(known, row);
            live.set(key, known);
          }
        }
      }

      entries = live;
      cards.sync((key, kind) => {
        const found = live.get(key);

        if (found === undefined) {
          return null;
        }

        return kind === "count" ? found.row.tip : found.row.titleTip;
      });

      list.replaceChildren(
        ...(shown.loading
          ? [loadingNode(model.tab)]
          : shown.notice !== null
            ? [el("p", "commits-notice", shown.notice)]
            : [...live.values()].map((entry) => entry.node)),
        ...(shown.note === null
          ? []
          : [el("p", "commits-list-note", shown.note)]),
      );
    },
  };
}
