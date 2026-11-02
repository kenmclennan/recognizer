import { button, el } from "./dom";
import type { NoteRow } from "./note-focus";

export type NotesPanelProps = {
  hasView: boolean;
  rows: readonly NoteRow[];
};

export type NoteRowActions = {
  toggle: (path: string) => void;
  remove: (path: string) => void;
  edit?: (path: string) => void;
};

export type NotesPanelActions = NoteRowActions;

export type NotesPanelView = {
  element: HTMLElement;
  render: (props: NotesPanelProps) => void;
};

function displayName(path: string): string {
  const bare = path.endsWith("/") ? path.slice(0, -1) : path;
  const name = bare.slice(bare.lastIndexOf("/") + 1);

  return path.endsWith("/") ? `${name}/` : name;
}

export function buildNoteRow(
  row: NoteRow,
  actions: NoteRowActions,
  named = false,
): HTMLElement {
  const node = el(
    "div",
    `note-row ${row.kind}${row.off ? " off" : ""}${row.active ? " active" : ""}`,
  );
  const remove = button("Remove", "note-remove", () =>
    actions.remove(row.path),
  );

  node.dataset.path = row.path;
  remove.setAttribute("aria-label", "Remove note");
  remove.title = "Remove note";

  if (named) {
    const title = el("span", "note-path", displayName(row.path));

    title.title = row.path;
    node.append(title);
  }

  node.append(
    el("span", "note-text", row.text),
    el("span", "note-by", `by ${row.by}`),
  );

  if (actions.edit !== undefined) {
    const edit = actions.edit;

    node.append(button("Edit", "note-edit", () => edit(row.path)));
  }

  node.append(remove);

  if (!row.off) {
    node.addEventListener("click", () => actions.toggle(row.path));
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

  return {
    element,
    render(next) {
      prompt.hidden = next.hasView;

      if (!next.hasView) {
        list.replaceChildren();

        return;
      }

      const on = next.rows.filter((row) => !row.off);
      const off = next.rows.filter((row) => row.off);
      const parts: HTMLElement[] = on.map((row) =>
        buildNoteRow(row, actions, true),
      );

      if (off.length > 0) {
        const section = el("section", "note-off");

        section.append(
          el("h3", "note-group-title", "Not on the canvas"),
          ...off.map((row) => buildNoteRow(row, actions, true)),
        );
        parts.push(section);
      }

      list.replaceChildren(...parts);
    },
  };
}
