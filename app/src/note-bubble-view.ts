import { button, el } from "./dom";
import type { BubblePlace, StepModel } from "./note-focus";

export type NoteBubble = {
  path: string;
  text: string | null;
  by: string | null;
  editing: boolean;
  focused: boolean;
  step?: StepModel | null;
};

export type NoteBubbleActions = {
  focus: (path: string) => void;
  edit: (path: string) => void;
  cancel: (path: string) => void;
  save: (path: string, text: string) => void;
  remove: (path: string) => void;
  previous: (path: string) => void;
  next: (path: string) => void;
};

export type NoteBubbleView = {
  element: HTMLElement;
  render: (bubble: NoteBubble, place: BubblePlace) => void;
  height: () => number;
  close: () => void;
};

export function buildNoteBubbleView(
  actions: NoteBubbleActions,
): NoteBubbleView {
  const element = el("div", "note-bubble");
  let shown: string | null = null;
  let draft = "";

  for (const type of ["pointerdown", "wheel", "click", "contextmenu"]) {
    element.addEventListener(type, (event) => event.stopPropagation());
  }

  element.addEventListener("click", () => {
    if (element.classList.contains("idle") && shown !== null) {
      actions.focus(shown);
    }
  });

  function readMode(bubble: NoteBubble) {
    const text = el("div", "note-text", bubble.text ?? "");
    const by = el("div", "note-by", `by ${bubble.by ?? ""}`);

    if (!bubble.focused) {
      return [text, by];
    }

    const row = el("div", "note-actions");

    text.addEventListener("click", () => actions.edit(bubble.path));
    row.append(
      button("Edit", "note-edit", () => actions.edit(bubble.path)),
      button("Remove", "note-remove", () => actions.remove(bubble.path)),
    );

    const step = bubble.step;

    if (step === null || step === undefined) {
      return [text, by, row];
    }

    const previous = button("Previous", "note-previous", () => {
      if (step.previous !== null) {
        actions.previous(step.previous);
      }
    });
    const next = button("Next", "note-next", () => {
      if (step.next !== null) {
        actions.next(step.next);
      }
    });
    const position = el(
      "span",
      "note-position",
      `${step.number} of ${step.total}`,
    );

    previous.disabled = step.previous === null;
    next.disabled = step.next === null;

    const header = el("div", "note-step");

    header.append(previous, position, next);

    return [header, text, by, row];
  }

  function editMode(bubble: NoteBubble) {
    const field = el("textarea", "note-field");
    const row = el("div", "note-actions");
    const save = button("Save", "note-save primary", () =>
      actions.save(bubble.path, field.value.trim()),
    );
    const cancel = button("Cancel", "note-cancel", () => {
      draft = "";
      actions.cancel(bubble.path);
    });

    field.rows = 4;
    field.setAttribute("aria-label", "Note");
    field.placeholder = "Add a note";
    field.value = draft !== "" ? draft : (bubble.text ?? "");
    save.disabled = field.value.trim() === "";
    field.addEventListener("input", () => {
      draft = field.value;
      save.disabled = field.value.trim() === "";
    });
    field.addEventListener("keydown", (event) => {
      event.stopPropagation();

      if (event.key === "Escape") {
        event.preventDefault();
        draft = "";
        actions.cancel(bubble.path);
      } else if (
        event.key === "Enter" &&
        (event.metaKey || event.ctrlKey) &&
        field.value.trim() !== ""
      ) {
        event.preventDefault();
        actions.save(bubble.path, field.value.trim());
      }
    });
    row.append(cancel, save);
    queueMicrotask(() => {
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    });

    return [field, row];
  }

  let editingNow = false;

  return {
    element,
    height() {
      return element.offsetHeight;
    },
    close() {
      shown = null;
      draft = "";
      editingNow = false;
      element.remove();
    },
    render(bubble, place) {
      const keepField = editingNow && shown === bubble.path && bubble.editing;

      if (shown !== bubble.path) {
        draft = "";
      }

      shown = bubble.path;
      element.dataset.path = bubble.path;
      element.className = `note-bubble ${place.side === "right" ? "right" : "left"}${bubble.focused ? "" : " idle"}`;
      element.style.left = `${place.left}px`;
      element.style.top = `${place.top}px`;
      element.style.setProperty("--tail-y", `${place.tailY}px`);

      if (keepField) {
        return;
      }

      editingNow = bubble.editing;
      element.replaceChildren(
        ...(bubble.editing ? editMode(bubble) : readMode(bubble)),
      );
    },
  };
}
