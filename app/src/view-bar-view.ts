import type { Note } from "recognizer";
import { button, el } from "./dom";
import { type IconName, icon } from "./icons";
import { VIEW_NAME } from "./views-port";

export type ViewBarItem = { name: string; description: string | null };

export type ViewBarProps = {
  open: string | null;
  views: ViewBarItem[];
  listed: boolean;
  listProblem: string | null;
  canBack: boolean;
  canForward: boolean;
  canCopy: boolean;
  note: Note | null;
};

export type ViewBarActions = {
  back: () => void;
  forward: () => void;
  openView: (name: string) => void;
  save: () => void;
  saveNew: (name: string, description: string) => Promise<string | null>;
  rename: (from: string, to: string) => Promise<string | null>;
  copyLink: () => void;
  hasOpenView: () => boolean;
  setNote: (text: string) => void;
  deleteNote: () => void;
};

export type ViewBar = {
  element: HTMLElement;
  render: (props: ViewBarProps) => void;
  dispose: () => void;
};

export function nameProblem(name: string, existing: string[]): string | null {
  if (!VIEW_NAME.test(name)) {
    return "Use letters, digits, - and _, starting with a letter or digit (64 at most)";
  }

  return existing.includes(name) ? `${name} already exists` : null;
}

export function canSaveNew(
  name: string,
  description: string,
  existing: string[],
): boolean {
  return nameProblem(name, existing) === null && description.trim() !== "";
}

export function buildViewBar(actions: ViewBarActions): ViewBar {
  const element = el("div", "view-bar");
  const back = iconButton("Back", "back", "chevron-left", () => actions.back());
  const forward = iconButton("Forward", "forward", "chevron-right", () =>
    actions.forward(),
  );
  const list = button("", "view-list", () => toggleMenu());
  const name = button("", "view-name", () => startEditing());
  const nameText = el("span", "view-name-text", "Untitled");
  const nameField = el("input", "view-name-field-inline");
  const nameProblemLine = el("p", "view-name-problem");
  const save = iconButton("Save the view", "save", "save", () => {
    if (actions.hasOpenView()) {
      actions.save();
    } else {
      dialogName = "";
      dialogOpen = true;
      renderOverlay();
    }
  });
  const copy = iconButton("Copy the view's link", "copy", "link", () =>
    actions.copyLink(),
  );
  const note = el("div", "view-note");
  const menu = el("div", "view-menu");
  const dialog = el("div", "view-dialog");

  note.hidden = true;
  menu.hidden = true;
  dialog.hidden = true;
  let props: ViewBarProps = {
    open: null,
    views: [],
    listed: false,
    listProblem: null,
    canBack: false,
    canForward: false,
    canCopy: false,
    note: null,
  };
  let noteDraft: string | null = null;
  let noteOwner: string | null = null;
  let menuOpen = false;
  let dialogOpen = false;
  let dialogName = "";
  let editing = false;

  list.append(icon("folder-open"), icon("chevron-down", "view-chevron"));
  list.setAttribute("aria-label", "Saved views");
  list.title = "Saved views";
  list.setAttribute("aria-haspopup", "menu");
  list.setAttribute("aria-expanded", "false");
  name.append(nameText);
  name.title = "Rename the view";
  nameField.hidden = true;
  nameField.setAttribute("aria-label", "View name");
  nameField.spellcheck = false;
  nameProblemLine.hidden = true;
  menu.setAttribute("role", "menu");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-label", "Save view");
  element.append(
    back,
    forward,
    list,
    name,
    nameField,
    save,
    copy,
    nameProblemLine,
    note,
    menu,
    dialog,
  );
  element.addEventListener("pointerdown", (event) => event.stopPropagation());

  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape" && (menuOpen || dialogOpen)) {
      closeOverlay();
    }
  };
  const closeOnOutside = (event: Event) => {
    if (
      (menuOpen || dialogOpen) &&
      !(event.target instanceof Node && element.contains(event.target))
    ) {
      closeOverlay();
    }
  };

  document.addEventListener("keydown", closeOnEscape);
  document.addEventListener("pointerdown", closeOnOutside, true);

  function closeOverlay() {
    menuOpen = false;
    dialogOpen = false;
    dialogName = "";
    renderOverlay();
  }

  function toggleMenu() {
    menuOpen = !menuOpen;
    dialogOpen = false;
    stopEditing();
    renderOverlay();
  }

  function renderName() {
    name.hidden = editing;
    nameField.hidden = !editing;
  }

  function startEditing() {
    menuOpen = false;
    dialogOpen = false;
    editing = true;
    nameField.value = props.open ?? "";
    nameField.placeholder = "Untitled";
    nameProblemLine.hidden = true;
    renderName();
    renderOverlay();
    nameField.focus();
    nameField.select();
  }

  function stopEditing() {
    editing = false;
    nameProblemLine.hidden = true;
    renderName();
  }

  async function commitName() {
    const next = nameField.value;
    const existing = props.views.map((view) => view.name);

    if (next === (props.open ?? "")) {
      stopEditing();

      return;
    }

    const problem = nameProblem(
      next,
      props.open === null ? existing : existing.filter((n) => n !== props.open),
    );

    if (problem !== null) {
      refuse(problem);

      return;
    }

    if (props.open === null) {
      stopEditing();
      dialogName = next;
      dialogOpen = true;
      renderOverlay();

      return;
    }

    const refused = await actions.rename(props.open, next);

    if (refused === null) {
      stopEditing();
    } else {
      refuse(refused);
    }
  }

  function refuse(reason: string) {
    nameProblemLine.textContent = reason;
    nameProblemLine.hidden = false;
    nameField.setAttribute("aria-invalid", "true");
  }

  nameField.addEventListener("input", () => {
    nameProblemLine.hidden = true;
    nameField.removeAttribute("aria-invalid");
  });
  nameField.addEventListener("keydown", (event) => {
    event.stopPropagation();

    if (event.key === "Enter") {
      event.preventDefault();
      void commitName();
    } else if (event.key === "Escape") {
      stopEditing();
    }
  });
  nameField.addEventListener("blur", () => {
    if (!editing) {
      return;
    }

    if (nameField.value === (props.open ?? "")) {
      stopEditing();
    } else {
      void commitName();
    }
  });

  function renderMenu() {
    menu.hidden = !menuOpen;
    list.setAttribute("aria-expanded", String(menuOpen));

    if (!menuOpen) {
      return;
    }

    if (!props.listed) {
      menu.replaceChildren(
        el(
          "p",
          "view-empty",
          props.listProblem === null
            ? "Saved views could not be listed"
            : `Saved views could not be listed: ${props.listProblem}`,
        ),
      );

      return;
    }

    if (props.views.length === 0) {
      menu.replaceChildren(el("p", "view-empty", "No saved views"));

      return;
    }

    menu.replaceChildren(
      ...props.views.map((view) => {
        const item = button(
          "",
          `view-item${view.name === props.open ? " current" : ""}`,
          () => {
            menuOpen = false;
            renderOverlay();
            actions.openView(view.name);
          },
        );

        item.setAttribute("role", "menuitem");
        item.append(
          el("span", "view-item-name", view.name),
          el(
            "span",
            "view-item-description",
            view.description ?? "not a valid view",
          ),
        );

        return item;
      }),
    );
  }

  function renderDialog() {
    dialog.hidden = !dialogOpen;

    if (!dialogOpen) {
      dialog.replaceChildren();

      return;
    }

    const nameInput = el("input", "view-field-name");
    const descriptionInput = el("textarea", "view-field-description");
    const problem = el("p", "view-problem");
    const confirm = button("Save", "view-confirm", () => {
      confirm.disabled = true;
      void actions
        .saveNew(nameInput.value, descriptionInput.value.trim())
        .then((failure) => {
          if (failure === null) {
            dialogOpen = false;
            dialogName = "";
            renderOverlay();

            return;
          }

          problem.textContent = failure;
          refresh(false);
        });
    });
    const cancel = button("Cancel", "view-cancel", () => {
      dialogOpen = false;
      dialogName = "";
      renderOverlay();
    });
    const existing = props.views.map((view) => view.name);
    const refresh = (clear = true) => {
      confirm.disabled = !canSaveNew(
        nameInput.value,
        descriptionInput.value,
        existing,
      );

      if (clear) {
        problem.textContent =
          nameInput.value === ""
            ? ""
            : (nameProblem(nameInput.value, existing) ?? "");
      }
    };

    nameInput.id = "view-name-field";
    nameInput.value = dialogName;
    descriptionInput.id = "view-description-field";
    descriptionInput.placeholder = "What it shows";
    descriptionInput.rows = 3;
    descriptionInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.stopPropagation();
      }
    });
    nameInput.addEventListener("input", () => refresh());
    descriptionInput.addEventListener("input", () => refresh());
    refresh();

    dialog.replaceChildren(
      labelled("Name", nameInput),
      labelled("Description", descriptionInput),
      problem,
      el("div", "view-dialog-actions"),
    );
    dialog.lastElementChild?.append(cancel, confirm);

    if (dialogName !== "") {
      descriptionInput.focus();
    }
  }

  function noteAction(label: string, className: string, run: () => void) {
    const node = button(label, className, run);

    node.title = label;

    return node;
  }

  function renderNote() {
    note.hidden = props.open === null;

    if (props.open === null) {
      noteDraft = null;
      note.replaceChildren();

      return;
    }

    if (noteOwner !== props.open) {
      noteOwner = props.open;
      noteDraft = null;
    }

    if (noteDraft !== null && note.querySelector("textarea") !== null) {
      return;
    }

    if (noteDraft !== null) {
      const field = el("textarea", "note-field");
      const save = noteAction("Save", "note-save", () => {
        actions.setNote(field.value);
        noteDraft = null;
        renderNote();
      });

      field.rows = 3;
      field.value = noteDraft;
      field.setAttribute("aria-label", "View note");
      save.disabled = noteDraft.trim() === "";
      field.addEventListener("keydown", (event) => {
        event.stopPropagation();

        if (event.key === "Escape") {
          noteDraft = null;
          renderNote();
        }
      });
      field.addEventListener("input", () => {
        noteDraft = field.value;
        save.disabled = field.value.trim() === "";
      });
      note.replaceChildren(
        field,
        noteAction("Cancel", "note-cancel", () => {
          noteDraft = null;
          renderNote();
        }),
        save,
      );
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);

      return;
    }

    if (props.note === null) {
      note.replaceChildren(
        noteAction("Add note", "note-add", () => {
          noteDraft = "";
          renderNote();
        }),
      );

      return;
    }

    const current = props.note;

    note.replaceChildren(
      el("span", "note-text", current.text),
      el("span", "note-by", `by ${current.by}`),
      noteAction("Edit", "note-edit", () => {
        noteDraft = current.text;
        renderNote();
      }),
      noteAction("Delete", "note-delete", () => actions.deleteNote()),
    );
  }

  function renderOverlay() {
    renderMenu();
    renderDialog();
  }

  return {
    element,
    render(next) {
      props = next;
      back.disabled = !next.canBack;
      forward.disabled = !next.canForward;
      nameText.textContent = next.open ?? "Untitled";
      renderName();
      copy.disabled = !next.canCopy;
      renderMenu();
      renderNote();
    },
    dispose() {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutside, true);
    },
  };
}

function iconButton(
  label: string,
  className: string,
  glyph: IconName,
  run: () => void,
) {
  const node = button("", `view-${className} view-icon`, run);

  node.append(icon(glyph));
  node.setAttribute("aria-label", label);
  node.title = label;

  return node;
}

function labelled(text: string, input: HTMLInputElement | HTMLTextAreaElement) {
  const label = el("label", "view-field");
  const caption = el("span", "view-field-label", text);

  label.htmlFor = input.id;
  label.append(caption, input);

  return label;
}
