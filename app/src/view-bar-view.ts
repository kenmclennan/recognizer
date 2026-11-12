import { button, el } from "./dom";
import { type IconName, icon } from "./icons";
import { buildDetailsCard, nameProblem } from "./view-details-card-view";

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
  openPlan: boolean;
  listed: boolean;
  listProblem: string | null;
  canBack: boolean;
  canForward: boolean;
  backLabel: string;
  forwardLabel: string;
  canCopy: boolean;
  canvasEmpty: boolean;
  openTitle: string | null;
  openDescription: string | null;
  modified: boolean;
  unsaved: boolean;
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
  promptSave: () => void;
  render: (props: ViewBarProps) => void;
  dispose: () => void;
};

export { nameProblem };

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
  const planTag = el("span", "view-plan-tag", "Plan");
  const nameText = el("span", "view-name-text", "Untitled");
  const details = buildDetailsCard({
    idPrefix: "view-details",
    commit: (name, title, description) =>
      props.open === null
        ? actions.saveNew(name, title ?? "", description)
        : actions.saveDetails(name, title, description),
    done: () => {
      editing = false;
      card.hidden = true;
      actions.preview(null);
    },
    cancel: () => cancelEditing(),
    draft: (draft) => actions.preview(draft),
  });
  const card = details.element;
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
  const unsavedMark = el("span", "view-unsaved", "unsaved");
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
    openPlan: false,
    listed: false,
    listProblem: null,
    canBack: false,
    canForward: false,
    backLabel: "Back",
    forwardLabel: "Forward",
    canCopy: false,
    canvasEmpty: true,
    openTitle: null,
    openDescription: null,
    modified: false,
    unsaved: false,
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
  unsavedMark.hidden = true;
  revert.hidden = true;
  revert.disabled = true;
  card.hidden = true;
  menu.setAttribute("role", "menu");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-label", "Save view");
  element.append(
    back,
    forward,
    list,
    name,
    modifiedMark,
    unsavedMark,
    rangeChip,
    planTag,
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

  function startEditing() {
    menuOpen = false;
    dialogOpen = false;
    editing = true;
    details.open(
      {
        name: props.open ?? "",
        title: props.openTitle,
        description: props.openDescription ?? "",
        isNew: props.open === null,
      },
      otherNames(),
    );
    card.hidden = false;
    renderOverlay();
    details.focus();
  }

  function cancelEditing() {
    if (!editing) {
      return;
    }

    editing = false;
    card.hidden = true;
    actions.preview(null);
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
    promptSave() {
      menuOpen = false;
      cancelEditing();
      dialogName = "";
      dialogOpen = true;
      renderOverlay();
    },
    render(next) {
      const previousOpen = props.open;

      props = next;
      back.disabled = !next.canBack;
      forward.disabled = !next.canForward;
      relabel(back, next.backLabel);
      relabel(forward, next.forwardLabel);
      nameText.textContent = next.unsaved
        ? "Change"
        : (next.open ?? "Untitled");
      rangeChip.hidden = next.openChip === null;
      rangeChip.textContent = next.openChip ?? "";
      planTag.hidden = !next.openPlan;
      if (editing && next.open !== previousOpen) {
        cancelEditing();
      } else if (editing) {
        details.setNames(otherNames());
      }

      modifiedMark.hidden = next.open === null || !next.modified;
      unsavedMark.hidden = !next.unsaved;
      save.disabled =
        next.open !== null ? !next.modified : next.canvasEmpty && !next.unsaved;
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
