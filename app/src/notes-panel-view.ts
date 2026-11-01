import { button, el } from "./dom";
import type { NoteRow } from "./note-focus";
import type { NoteOrder } from "./notes-order";

export type NotesPanelProps = {
  hasView: boolean;
  order: NoteOrder;
  rows: ReadonlyMap<number, NoteRow>;
};

export type NoteRowActions = {
  toggle: (index: number) => void;
  remove: (index: number) => void;
};

export type NotesPanelActions = NoteRowActions;

export type NotesPanelView = {
  element: HTMLElement;
  render: (props: NotesPanelProps) => void;
};

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function buildNoteRow(
  row: NoteRow,
  actions: NoteRowActions,
): HTMLElement {
  const node = el(
    "div",
    `note-row ${row.tint}${row.off ? " off" : ""}${row.active ? " active" : ""}`,
  );
  const remove = button("Remove", "note-remove", () =>
    actions.remove(row.index),
  );

  node.dataset.index = String(row.index);
  remove.setAttribute("aria-label", "Remove note");
  remove.title = "Remove note";
  remove.textContent = "×";
  node.append(
    el("span", "note-text", row.text),
    el("span", "note-by", `by ${row.by}`),
    remove,
  );

  if (!row.off) {
    node.addEventListener("click", () => actions.toggle(row.index));
  }

  return node;
}

export function buildNotesPanelView(
  actions: NotesPanelActions,
): NotesPanelView {
  const element = el("div", "notes-panel");
  const header = el("div", "notes-header", "Notes");
  const prompt = el("p", "notes-hint", "Open or save a view to add notes");
  const list = el("div", "note-list");

  element.append(header, prompt, list);

  function group(module: string, rows: NoteRow[]) {
    const node = el("section", "note-group");
    const heading = el("h3", "note-group-title");
    const dir = module.slice(0, module.length - fileName(module).length);

    node.dataset.module = module;
    heading.append(dir, el("strong", "", fileName(module)));
    node.append(heading, ...rows.map((row) => buildNoteRow(row, actions)));

    return node;
  }

  return {
    element,
    render(next) {
      prompt.hidden = next.hasView;

      if (!next.hasView) {
        list.replaceChildren();

        return;
      }

      const rowOf = (index: number) => next.rows.get(index) as NoteRow;
      const parts: HTMLElement[] = next.order.groups.map((entry) =>
        group(
          entry.module,
          entry.entries.map((one) => rowOf(one.index)),
        ),
      );

      if (next.order.off.length > 0) {
        const off = el("section", "note-off");

        off.append(
          el("h3", "note-group-title", "Not on the canvas"),
          ...next.order.off.map((one) =>
            buildNoteRow(rowOf(one.index), actions),
          ),
        );
        parts.push(off);
      }

      list.replaceChildren(...parts);
    },
  };
}
