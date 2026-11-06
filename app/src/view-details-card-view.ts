import { button, el } from "./dom";
import { VIEW_NAME } from "./views-port";

export function nameProblem(name: string, existing: string[]): string | null {
  if (name === "") {
    return "A view needs a name";
  }

  if (!VIEW_NAME.test(name)) {
    return "Use letters, digits, - and _, starting with a letter or digit (64 at most)";
  }

  return existing.includes(name) ? `${name} already exists` : null;
}

export type DetailsInit = {
  name: string;
  title: string | null;
  description: string;
  isNew: boolean;
};

export type DetailsCardOptions = {
  idPrefix: string;
  commit: (
    name: string,
    title: string | null,
    description: string,
  ) => Promise<string | null>;
  done: () => void;
  cancel: () => void;
  draft?: (draft: { title: string | null; description: string }) => void;
};

export type DetailsCard = {
  element: HTMLElement;
  open: (init: DetailsInit, names: string[]) => void;
  setNames: (names: string[]) => void;
  focus: () => void;
};

export function buildDetailsCard(options: DetailsCardOptions): DetailsCard {
  const card = el("div", "view-details");
  const nameField = el("input", "view-details-name");
  const titleField = el("input", "view-details-title");
  const descriptionField = el("textarea", "view-details-description");
  const problemLine = el("p", "view-details-problem");
  const cancelButton = button("Cancel", "view-details-cancel", () =>
    options.cancel(),
  );
  const saveButton = button("Save", "view-details-save", () => void commit());
  let initial: DetailsInit = {
    name: "",
    title: null,
    description: "",
    isNew: true,
  };
  let names: string[] = [];

  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", "View details");
  nameField.id = `${options.idPrefix}-name-field`;
  nameField.spellcheck = false;
  nameField.placeholder = "Untitled";
  titleField.id = `${options.idPrefix}-title-field`;
  titleField.placeholder = "Heading shown above the diagram";
  descriptionField.id = `${options.idPrefix}-description-field`;
  descriptionField.placeholder = "What it shows";
  descriptionField.rows = 3;
  problemLine.hidden = true;
  card.append(
    labelled("Name", nameField),
    problemLine,
    labelled("Title", titleField),
    labelled("Description", descriptionField),
    el("div", "view-details-actions"),
  );
  card.lastElementChild?.append(cancelButton, saveButton);

  function differs(): boolean {
    return (
      initial.isNew ||
      nameField.value !== initial.name ||
      titleField.value.trim() !== (initial.title ?? "") ||
      descriptionField.value.trim() !== initial.description
    );
  }

  function refresh(showName = false) {
    const problem = nameProblem(nameField.value, names);

    if (showName) {
      problemLine.textContent = problem ?? "";
      problemLine.hidden = problem === null;

      if (problem === null) {
        nameField.removeAttribute("aria-invalid");
      } else {
        nameField.setAttribute("aria-invalid", "true");
      }
    }

    saveButton.disabled =
      problem !== null || descriptionField.value.trim() === "" || !differs();
  }

  function previewDraft() {
    if (initial.isNew || options.draft === undefined) {
      return;
    }

    const title = titleField.value.trim();

    options.draft({
      title: title === "" ? null : title,
      description: descriptionField.value.trim(),
    });
  }

  async function commit() {
    if (saveButton.disabled) {
      return;
    }

    const title = titleField.value.trim();

    saveButton.disabled = true;

    const refused = await options.commit(
      nameField.value,
      title === "" ? null : title,
      descriptionField.value.trim(),
    );

    if (refused === null) {
      options.done();

      return;
    }

    problemLine.textContent = refused;
    problemLine.hidden = false;
    nameField.setAttribute("aria-invalid", "true");
    saveButton.disabled = false;
  }

  nameField.addEventListener("input", () => refresh(true));
  titleField.addEventListener("input", () => {
    refresh();
    previewDraft();
  });
  descriptionField.addEventListener("input", () => {
    refresh();
    previewDraft();
  });

  const fields: HTMLElement[] = [nameField, titleField, descriptionField];

  for (const field of fields) {
    field.addEventListener("keydown", (event) => {
      event.stopPropagation();

      if (event.key === "Escape") {
        options.cancel();
      } else if (
        event.key === "Enter" &&
        (field !== descriptionField || event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault();
        void commit();
      }
    });
  }

  return {
    element: card,
    open(init, existing) {
      initial = init;
      names = existing;
      nameField.value = init.name;
      titleField.value = init.title ?? "";
      descriptionField.value = init.description;
      problemLine.hidden = true;
      nameField.removeAttribute("aria-invalid");
      refresh();
    },
    setNames(existing) {
      names = existing;
      refresh();
    },
    focus() {
      if (initial.isNew) {
        nameField.focus();
      } else {
        titleField.focus();
        titleField.select();
      }
    },
  };
}

function labelled(text: string, input: HTMLInputElement | HTMLTextAreaElement) {
  const label = el("label", "view-field");
  const caption = el("span", "view-field-label", text);

  label.htmlFor = input.id;
  label.append(caption, input);

  return label;
}
