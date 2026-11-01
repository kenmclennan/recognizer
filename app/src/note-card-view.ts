import { button, el } from "./dom";
import type { CardLayout } from "./notes-order";

export type NoteCardEntry = {
  index: number;
  text: string;
  by: string;
  tint: "person" | "agent";
};

export type NoteCard = {
  module: string;
  active: number | null;
  entries: NoteCardEntry[];
  compose: boolean;
};

export type NoteCardActions = {
  add: (module: string, text: string) => void;
  remove: (index: number) => void;
};

export type NoteCardView = {
  element: HTMLElement;
  render: (card: NoteCard, layout: CardLayout) => void;
  height: () => number;
  focusField: () => void;
  close: () => void;
};

export function buildNoteCardView(actions: NoteCardActions): NoteCardView {
  const element = el("div", "note-card");
  const list = el("div", "note-card-list");
  const field = el("textarea", "note-card-field");
  const add = button("Add note", "note-card-add", () => submit());
  const drafts = new Map<string, string>();
  let shown: string | null = null;

  field.rows = 3;
  field.setAttribute("aria-label", "Note");
  field.placeholder = "Add a note";
  add.disabled = true;
  element.append(list, field, add);

  for (const type of ["pointerdown", "wheel", "click", "contextmenu"]) {
    element.addEventListener(type, (event) => event.stopPropagation());
  }

  function submit() {
    const text = field.value.trim();

    if (shown === null || text === "") {
      return;
    }

    const module = shown;

    drafts.delete(module);
    field.value = "";
    add.disabled = true;
    actions.add(module, text);
  }

  field.addEventListener("input", () => {
    add.disabled = field.value.trim() === "";

    if (shown !== null) {
      drafts.set(shown, field.value);
    }
  });
  field.addEventListener("keydown", (event) => {
    event.stopPropagation();

    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    } else if (event.key === "Escape" && field.value !== "") {
      event.preventDefault();

      if (shown !== null) {
        drafts.delete(shown);
      }

      field.value = "";
      add.disabled = true;
      field.blur();
    } else if (event.key === "Escape") {
      field.blur();
    }
  });

  function block(entry: NoteCardEntry, active: number | null) {
    const node = el(
      "div",
      `note-block ${entry.tint}${entry.index === active ? " active" : ""}`,
    );
    const remove = button("×", "note-remove", () =>
      actions.remove(entry.index),
    );

    node.dataset.index = String(entry.index);
    remove.title = "Remove note";
    remove.setAttribute("aria-label", "Remove note");
    node.append(
      el("span", "note-text", entry.text),
      el("span", "note-by", `by ${entry.by}`),
      remove,
    );

    return node;
  }

  return {
    element,
    height() {
      return element.offsetHeight;
    },
    focusField() {
      field.focus();
    },
    close() {
      drafts.clear();
      shown = null;
      field.value = "";
      add.disabled = true;
      element.remove();
    },
    render(card, layout) {
      if (card.module !== shown) {
        for (const key of [...drafts.keys()]) {
          if (key !== card.module) {
            drafts.delete(key);
          }
        }

        shown = card.module;
        field.value = drafts.get(card.module) ?? "";
        add.disabled = field.value.trim() === "";
      }

      element.dataset.module = card.module;
      element.style.left = `${layout.card.x}px`;
      element.style.top = `${layout.card.y}px`;
      element.style.width = `${layout.card.width}px`;
      element.style.height = "";
      list.replaceChildren(
        ...card.entries.map((entry) => block(entry, card.active)),
      );
    },
  };
}
