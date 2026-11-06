import { button, el } from "./dom";
import type { CardModel, CardRowModel } from "./finding-card";
import { shortName } from "./finding-sentence";
import type { FindingGroupModel } from "./findings-groups";

export type FindingRowActions = {
  toggle: (id: string) => void;
  addToView: (module: string) => void;
};

export type FindingsPanelActions = FindingRowActions & {
  toggleGroup: (key: string) => void;
  openSensors: () => void;
  setOnlyThisView: (on: boolean) => void;
};

export type FindingsPanelModel = {
  scope: { caption: string; on: boolean } | null;
  header: string | null;
  coverage: string | null;
  stale: string | null;
  groups: { group: FindingGroupModel; open: boolean; cards: CardModel[] }[];
  active: string | null;
  absent: (module: string) => boolean;
  empty: string | null;
};

export type FindingsPanelView = {
  element: HTMLElement;
  render: (model: FindingsPanelModel) => void;
};

function itemNode(
  row: CardRowModel,
  severity: "violation" | "warning",
  absent: boolean,
  actions: FindingRowActions,
): HTMLElement {
  const node = el("div", "finding-item");
  const text = el("span", "finding-item-text");

  node.append(el("span", `finding-mark ${severity}`), text);

  if (row.kind === "edge") {
    text.textContent = `${shortName(row.from)} -> ${shortName(row.to)}`;

    return node;
  }

  text.append(el("span", "finding-item-name", row.name));

  if (row.folder !== "") {
    text.append(el("span", "finding-folder", row.folder));
  }

  if (row.kind === "use") {
    text.append(
      el(
        "span",
        "finding-folder",
        row.names.length === 0 ? "(names unknown)" : row.names.join(", "),
      ),
    );
  }

  if (absent) {
    node.append(
      button("Add to view", "finding-add", () => actions.addToView(row.module)),
    );
  }

  return node;
}

export function buildFindingCard(
  card: CardModel,
  severity: "violation" | "warning",
  state: { open: boolean; absent: (module: string) => boolean },
  actions: FindingRowActions,
): HTMLElement {
  const node = el("div", state.open ? "finding-card open" : "finding-card");
  const head = button("", "finding-card-head", () => actions.toggle(card.id));

  node.dataset.id = card.id;
  head.setAttribute("aria-expanded", String(state.open));
  head.append(el("span", "finding-name", card.name));

  if (card.folder !== "") {
    head.append(el("span", "finding-folder", card.folder));
  }

  head.append(el("span", "finding-sentence", card.sentence));
  node.append(head);

  if (state.open) {
    const more = el("div", "finding-more");

    for (const row of card.rows) {
      more.append(
        itemNode(
          row,
          severity,
          row.kind !== "edge" && state.absent(row.module),
          actions,
        ),
      );
    }

    node.append(more);
  }

  return node;
}

export function buildFindingGroup(
  group: FindingGroupModel,
  open: boolean,
  cards: CardModel[],
  state: { active: string | null; absent: (module: string) => boolean },
  actions: FindingRowActions & { toggleGroup: (key: string) => void },
): HTMLElement {
  const block = el("div", open ? "finding-group open" : "finding-group");
  const head = button("", "finding-group-head", () =>
    actions.toggleGroup(group.key),
  );

  block.dataset.group = group.key;
  head.setAttribute("aria-expanded", String(open));
  head.append(
    el("span", "finding-chevron", "›"),
    el("span", `finding-mark ${group.severity}`),
    el("span", "finding-group-name", group.name),
    el("span", "finding-group-count", String(group.rows.length)),
  );
  block.append(head);

  if (open) {
    group.rows.forEach((row, index) => {
      block.append(
        buildFindingCard(
          cards[index] as CardModel,
          row.severity,
          { open: row.id === state.active, absent: state.absent },
          actions,
        ),
      );
    });
  }

  return block;
}

export function buildFindingsPanelView(
  actions: FindingsPanelActions,
): FindingsPanelView {
  const element = el("div", "findings-panel");
  const header = el("div", "findings-header", "Findings");
  const coverage = el("span", "findings-coverage");
  const scope = el("div", "findings-scope seg");
  const canvas = button("", "findings-scope-canvas", () =>
    actions.setOnlyThisView(true),
  );
  const all = button("Whole repository", "findings-scope-all", () =>
    actions.setOnlyThisView(false),
  );
  const line = el("p", "findings-line");
  const stale = button("", "findings-stale", () => actions.openSensors());
  const list = el("div", "finding-groups");
  const empty = el("p", "findings-empty");

  scope.append(canvas, all);
  header.append(coverage);
  element.append(header, scope, line, stale, list, empty);

  return {
    element,
    render(model) {
      const scopeOn = model.scope?.on ?? false;

      scope.hidden = model.scope === null;
      canvas.textContent = model.scope?.caption ?? "";
      canvas.setAttribute("aria-pressed", String(scopeOn));
      all.setAttribute("aria-pressed", String(!scopeOn));
      canvas.classList.toggle("on", scopeOn);
      all.classList.toggle("on", !scopeOn);
      coverage.textContent = model.coverage ?? "";
      line.textContent = model.header ?? "";
      line.hidden = model.header === null;
      stale.textContent = model.stale ?? "";
      stale.hidden = model.stale === null;
      empty.textContent = model.empty ?? "";
      empty.hidden = model.empty === null;
      list.replaceChildren(
        ...model.groups.map(({ group, open, cards }) =>
          buildFindingGroup(
            group,
            open,
            cards,
            { active: model.active, absent: model.absent },
            actions,
          ),
        ),
      );
    },
  };
}
