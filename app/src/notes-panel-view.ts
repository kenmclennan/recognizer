import { dropIndex } from "recognizer";
import { button, el } from "./dom";
import type { NoteRow } from "./note-focus";

export type NotesPanelProps = {
  hasView: boolean;
  rows: readonly NoteRow[];
  ordered: boolean;
};

export type NoteRowActions = {
  toggle: (path: string) => void;
  remove: (path: string) => void;
  edit?: (path: string) => void;
};

export type NotesPanelActions = NoteRowActions & {
  moveNote: (path: string, toIndex: number) => void;
  setOrdered: (ordered: boolean) => void;
};

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
  numbered = false,
): HTMLElement {
  const node = el(
    "div",
    `note-row ${row.kind}${row.off ? " off" : ""}${row.active ? " active" : ""}`,
  );
  const remove = button("Remove", "note-remove", () =>
    actions.remove(row.path),
  );

  node.dataset.path = row.path;

  if (numbered && row.number !== null) {
    node.append(el("span", "note-number", String(row.number)));
  }

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
  const header = el("div", "notes-header");
  const title = el("span", "notes-title", "Notes");
  const toggle = button("In order", "notes-order-toggle", () => {
    actions.setOrdered(toggle.getAttribute("aria-pressed") !== "true");
  });
  const prompt = el("p", "notes-hint", "Open or save a view to add notes");
  const list = el("div", "note-list");
  let current: readonly NoteRow[] = [];
  let dragging = false;
  let deferred: NotesPanelProps | null = null;

  function flush() {
    if (deferred !== null) {
      const next = deferred;

      deferred = null;
      view.render(next);
    }
  }

  header.append(title, toggle);
  element.append(header, prompt, list);

  function attachHandle(row: NoteRow, node: HTMLElement) {
    const handle = el("span", "note-handle");

    handle.setAttribute("aria-label", "Drag to reorder");
    handle.addEventListener("click", (event) => event.stopPropagation());
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      handle.setPointerCapture(event.pointerId);

      const nodes = [...list.querySelectorAll<HTMLElement>(".note-row")];
      const from = nodes.indexOf(node);
      const startY = event.clientY;
      const line = el("div", "note-drop-line");
      let target = from;
      let active = true;

      node.classList.add("dragging");
      list.append(line);

      const rects = nodes.map((entry) => entry.getBoundingClientRect());
      const midpoints = rects.map((box) => box.top + box.height / 2);
      const listTop = list.getBoundingClientRect().top;

      const place = (y: number) => {
        const index = dropIndex(midpoints, y);
        const edge =
          index >= rects.length
            ? (rects.at(-1) as DOMRect).bottom
            : (rects[index] as DOMRect).top;

        target = index > from ? index - 1 : index;
        line.style.top = `${edge - listTop}px`;
        line.dataset.index = String(index);
      };

      const stop = () => {
        active = false;
        dragging = false;
        node.classList.remove("dragging");
        node.style.transform = "";
        line.remove();
        document.removeEventListener("keydown", onKey, true);
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onCancel);
      };

      const onMove = (move: PointerEvent) => {
        if (active) {
          node.style.transform = `translateY(${move.clientY - startY}px)`;
          place(move.clientY);
        }
      };

      const onUp = (up: PointerEvent) => {
        if (!active) {
          return;
        }

        place(up.clientY);

        const moveTo = target;

        stop();
        flush();

        if (moveTo !== from) {
          actions.moveNote(row.path, moveTo);
        }
      };

      const onCancel = () => {
        stop();
        flush();
      };

      const onKey = (key: KeyboardEvent) => {
        if (key.key === "Escape") {
          key.preventDefault();
          key.stopPropagation();
          stop();
          flush();
        }
      };

      dragging = true;
      document.addEventListener("keydown", onKey, true);
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onCancel);
      place(event.clientY);
    });
    node.prepend(handle);
  }

  const view: NotesPanelView = {
    element,
    render(next) {
      if (dragging) {
        deferred = next;

        return;
      }

      prompt.hidden = next.hasView;
      toggle.hidden = !next.hasView;
      toggle.textContent = next.ordered ? "In order" : "No order";
      toggle.setAttribute("aria-pressed", String(next.ordered));
      current = next.rows;

      if (!next.hasView) {
        list.replaceChildren();

        return;
      }

      if (next.ordered) {
        list.replaceChildren(
          ...current.map((row) => {
            const node = buildNoteRow(row, actions, true, true);

            attachHandle(row, node);

            return node;
          }),
        );

        return;
      }

      const on = current.filter((row) => !row.off);
      const off = current.filter((row) => row.off);
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

  return view;
}
