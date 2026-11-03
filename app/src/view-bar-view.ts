import { button, el } from "./dom";
import { type IconName, icon } from "./icons";
import { VIEW_NAME } from "./views-port";

export type ViewBarItem = {
  name: string;
  description: string | null;
  chip: string | null;
};

export type ViewBarProps = {
  open: string | null;
  views: ViewBarItem[];
  names: string[];
  total: number;
  openChip: string | null;
  listed: boolean;
  listProblem: string | null;
  canBack: boolean;
  canForward: boolean;
  backLabel: string;
  forwardLabel: string;
  canCopy: boolean;
  openTitle: string | null;
};

export type ViewBarActions = {
  back: () => void;
  forward: () => void;
  openView: (name: string) => void;
  openViewsPanel: () => void;
  save: () => void;
  saveNew: (
    name: string,
    title: string,
    description: string,
  ) => Promise<string | null>;
  retitle: (name: string, title: string | null) => Promise<void>;
  rename: (from: string, to: string) => Promise<string | null>;
  copyLink: () => void;
  hasOpenView: () => boolean;
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
  const rangeChip = el("span", "view-range-chip");
  const nameText = el("span", "view-name-text", "Untitled");
  const nameField = el("input", "view-name-field-inline");
  const titleField = el("input", "view-title-field-inline");
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
  const menu = el("div", "view-menu");
  const dialog = el("div", "view-dialog");

  menu.hidden = true;
  dialog.hidden = true;
  let props: ViewBarProps = {
    open: null,
    views: [],
    names: [],
    total: 0,
    openChip: null,
    listed: false,
    listProblem: null,
    canBack: false,
    canForward: false,
    backLabel: "Back",
    forwardLabel: "Forward",
    canCopy: false,
    openTitle: null,
  };
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
  titleField.hidden = true;
  titleField.setAttribute("aria-label", "View title");
  titleField.placeholder = "Title";
  nameProblemLine.hidden = true;
  menu.setAttribute("role", "menu");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-label", "Save view");
  element.append(
    back,
    forward,
    list,
    name,
    rangeChip,
    nameField,
    titleField,
    save,
    copy,
    nameProblemLine,
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
    titleField.hidden = !editing || props.open === null;
  }

  function startEditing() {
    menuOpen = false;
    dialogOpen = false;
    editing = true;
    nameField.value = props.open ?? "";
    nameField.placeholder = "Untitled";
    titleField.value = props.openTitle ?? "";
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

  function titleChanged(): boolean {
    return (
      props.open !== null && titleField.value.trim() !== (props.openTitle ?? "")
    );
  }

  function changed(): boolean {
    return nameField.value !== (props.open ?? "") || titleChanged();
  }

  async function commitName() {
    const next = nameField.value;
    const existing = props.names;
    let current = props.open;

    if (!changed()) {
      stopEditing();

      return;
    }

    if (next !== (props.open ?? "")) {
      const problem = nameProblem(
        next,
        props.open === null
          ? existing
          : existing.filter((n) => n !== props.open),
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

      if (refused !== null) {
        refuse(refused);

        return;
      }

      current = next;
    }

    if (current !== null && titleChanged()) {
      const title = titleField.value.trim();

      await actions.retitle(current, title === "" ? null : title);
    }

    stopEditing();
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
  for (const field of [nameField, titleField]) {
    field.addEventListener("keydown", (event) => {
      event.stopPropagation();

      if (event.key === "Enter") {
        event.preventDefault();
        void commitName();
      } else if (event.key === "Escape") {
        stopEditing();
      }
    });
    field.addEventListener("blur", (event) => {
      if (
        !editing ||
        event.relatedTarget === nameField ||
        event.relatedTarget === titleField
      ) {
        return;
      }

      if (changed()) {
        void commitName();
      } else {
        stopEditing();
      }
    });
  }

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

        if (view.chip !== null) {
          item.append(el("span", "view-item-chip", view.chip));
        }

        return item;
      }),
      ...(props.total > props.views.length
        ? [
            button(`All views (${props.total})`, "view-all", () => {
              menuOpen = false;
              renderOverlay();
              actions.openViewsPanel();
            }),
          ]
        : []),
    );
  }

  function renderDialog() {
    dialog.hidden = !dialogOpen;

    if (!dialogOpen) {
      dialog.replaceChildren();

      return;
    }

    const nameInput = el("input", "view-field-name");
    const titleInput = el("input", "view-field-title");
    const descriptionInput = el("textarea", "view-field-description");
    const problem = el("p", "view-problem");
    const confirm = button("Save", "view-confirm", () => {
      confirm.disabled = true;
      void actions
        .saveNew(
          nameInput.value,
          titleInput.value.trim(),
          descriptionInput.value.trim(),
        )
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
    const existing = props.names;
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
    titleInput.id = "view-title-field";
    titleInput.placeholder = "Heading shown above the diagram";
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
      labelled("Title", titleInput),
      labelled("Description", descriptionInput),
      problem,
      el("div", "view-dialog-actions"),
    );
    dialog.lastElementChild?.append(cancel, confirm);

    if (dialogName !== "") {
      descriptionInput.focus();
    }
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
      relabel(back, next.backLabel);
      relabel(forward, next.forwardLabel);
      nameText.textContent = next.open ?? "Untitled";
      rangeChip.hidden = next.openChip === null;
      rangeChip.textContent = next.openChip ?? "";
      renderName();
      copy.disabled = !next.canCopy;
      renderMenu();
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

function relabel(node: HTMLElement, label: string) {
  node.setAttribute("aria-label", label);
  node.title = label;
}

function labelled(text: string, input: HTMLInputElement | HTMLTextAreaElement) {
  const label = el("label", "view-field");
  const caption = el("span", "view-field-label", text);

  label.htmlFor = input.id;
  label.append(caption, input);

  return label;
}
