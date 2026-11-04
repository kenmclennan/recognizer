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
  openDescription: string | null;
  modified: boolean;
  canRevert: boolean;
  revertLabel: string;
};

export type ViewBarActions = {
  back: () => void;
  forward: () => void;
  openView: (name: string) => void;
  openViewsPanel: () => void;
  save: () => void;
  revert: () => void;
  saveNew: (
    name: string,
    title: string,
    description: string,
  ) => Promise<string | null>;
  saveDetails: (
    name: string,
    title: string | null,
    description: string,
  ) => Promise<string | null>;
  preview: (
    draft: { title: string | null; description: string } | null,
  ) => void;
  copyLink: () => void;
  hasOpenView: () => boolean;
};

export type ViewBar = {
  element: HTMLElement;
  render: (props: ViewBarProps) => void;
  dispose: () => void;
};

export function nameProblem(name: string, existing: string[]): string | null {
  if (name === "") {
    return "A view needs a name";
  }

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
  const name = button("", "view-name", () =>
    editing ? cancelEditing() : startEditing(),
  );
  const rangeChip = el("span", "view-range-chip");
  const nameText = el("span", "view-name-text", "Untitled");
  const card = el("div", "view-details");
  const nameField = el("input", "view-details-name");
  const titleField = el("input", "view-details-title");
  const descriptionField = el("textarea", "view-details-description");
  const nameProblemLine = el("p", "view-details-problem");
  const cardCancel = button("Cancel", "view-details-cancel", () =>
    cancelEditing(),
  );
  const cardSave = button("Save", "view-details-save", () => void commit());
  const save = iconButton("Save the view", "save", "save", () => {
    if (actions.hasOpenView()) {
      actions.save();
    } else {
      dialogName = "";
      dialogOpen = true;
      renderOverlay();
    }
  });
  const revert = iconButton("Revert to saved", "revert", "rotate-ccw", () =>
    actions.revert(),
  );
  const modifiedMark = el("span", "view-modified", "modified");
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
    openDescription: null,
    modified: false,
    canRevert: false,
    revertLabel: "Revert to saved",
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
  modifiedMark.hidden = true;
  revert.hidden = true;
  revert.disabled = true;
  card.hidden = true;
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", "View details");
  nameField.id = "view-details-name-field";
  nameField.spellcheck = false;
  nameField.placeholder = "Untitled";
  titleField.id = "view-details-title-field";
  titleField.placeholder = "Heading shown above the diagram";
  descriptionField.id = "view-details-description-field";
  descriptionField.placeholder = "What it shows";
  descriptionField.rows = 3;
  nameProblemLine.hidden = true;
  card.append(
    labelled("Name", nameField),
    nameProblemLine,
    labelled("Title", titleField),
    labelled("Description", descriptionField),
    el("div", "view-details-actions"),
  );
  card.lastElementChild?.append(cardCancel, cardSave);
  menu.setAttribute("role", "menu");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-label", "Save view");
  element.append(
    back,
    forward,
    list,
    name,
    modifiedMark,
    rangeChip,
    save,
    revert,
    copy,
    card,
    menu,
    dialog,
  );
  element.addEventListener("pointerdown", (event) => event.stopPropagation());

  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape" && editing) {
      cancelEditing();
    } else if (event.key === "Escape" && (menuOpen || dialogOpen)) {
      closeOverlay();
    }
  };
  const closeOnOutside = (event: Event) => {
    if (event.target instanceof Node && element.contains(event.target)) {
      return;
    }

    if (editing) {
      cancelEditing();
    }

    if (menuOpen || dialogOpen) {
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
    cancelEditing();
    renderOverlay();
  }

  function otherNames(): string[] {
    return props.names.filter((n) => n !== props.open);
  }

  function draftNameProblem(): string | null {
    return nameProblem(nameField.value, otherNames());
  }

  function differs(): boolean {
    return (
      props.open === null ||
      nameField.value !== props.open ||
      titleField.value.trim() !== (props.openTitle ?? "") ||
      descriptionField.value.trim() !== (props.openDescription ?? "")
    );
  }

  function refreshCard(showName = false) {
    const problem = draftNameProblem();

    if (showName) {
      nameProblemLine.textContent = problem ?? "";
      nameProblemLine.hidden = problem === null;

      if (problem === null) {
        nameField.removeAttribute("aria-invalid");
      } else {
        nameField.setAttribute("aria-invalid", "true");
      }
    }

    cardSave.disabled =
      problem !== null || descriptionField.value.trim() === "" || !differs();
  }

  function previewDraft() {
    if (props.open === null) {
      return;
    }

    const title = titleField.value.trim();

    actions.preview({
      title: title === "" ? null : title,
      description: descriptionField.value.trim(),
    });
  }

  function startEditing() {
    menuOpen = false;
    dialogOpen = false;
    editing = true;
    nameField.value = props.open ?? "";
    titleField.value = props.openTitle ?? "";
    descriptionField.value = props.openDescription ?? "";
    nameProblemLine.hidden = true;
    nameField.removeAttribute("aria-invalid");
    card.hidden = false;
    refreshCard();
    renderOverlay();

    if (props.open === null) {
      nameField.focus();
    } else {
      titleField.focus();
      titleField.select();
    }
  }

  function cancelEditing() {
    if (!editing) {
      return;
    }

    editing = false;
    card.hidden = true;
    actions.preview(null);
  }

  async function commit() {
    if (cardSave.disabled) {
      return;
    }

    const title = titleField.value.trim();
    const description = descriptionField.value.trim();

    cardSave.disabled = true;

    const refused =
      props.open === null
        ? await actions.saveNew(nameField.value, title, description)
        : await actions.saveDetails(
            nameField.value,
            title === "" ? null : title,
            description,
          );

    if (refused === null) {
      editing = false;
      card.hidden = true;
      actions.preview(null);

      return;
    }

    nameProblemLine.textContent = refused;
    nameProblemLine.hidden = false;
    nameField.setAttribute("aria-invalid", "true");
    cardSave.disabled = false;
  }

  nameField.addEventListener("input", () => refreshCard(true));
  titleField.addEventListener("input", () => {
    refreshCard();
    previewDraft();
  });
  descriptionField.addEventListener("input", () => {
    refreshCard();
    previewDraft();
  });
  const cardFields: HTMLElement[] = [nameField, titleField, descriptionField];

  for (const field of cardFields) {
    field.addEventListener("keydown", (event) => {
      event.stopPropagation();

      if (event.key === "Escape") {
        cancelEditing();
      } else if (
        event.key === "Enter" &&
        (field !== descriptionField || event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault();
        void commit();
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
      const previousOpen = props.open;

      props = next;
      back.disabled = !next.canBack;
      forward.disabled = !next.canForward;
      relabel(back, next.backLabel);
      relabel(forward, next.forwardLabel);
      nameText.textContent = next.open ?? "Untitled";
      rangeChip.hidden = next.openChip === null;
      rangeChip.textContent = next.openChip ?? "";
      if (editing && next.open !== previousOpen) {
        cancelEditing();
      }

      modifiedMark.hidden = next.open === null || !next.modified;
      save.disabled = next.open !== null && !next.modified;
      revert.hidden = next.open === null;
      revert.disabled = !next.canRevert;
      relabel(revert, next.revertLabel);
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
