import { button, el } from "./dom";

export type ClearChoice = "cancel" | "discard" | "save";

export type ClearPromptView = {
  element: HTMLElement;
  show: (name: string, choose: (choice: ClearChoice) => void) => void;
  hide: () => void;
};

export function buildClearPrompt(): ClearPromptView {
  const element = el("div", "clear-prompt");
  const heading = el("p", "clear-prompt-heading");
  const body = el(
    "p",
    "clear-prompt-body",
    "Clearing closes the view. Your changes since it was saved will be lost unless you save them.",
  );
  const actions = el("div", "clear-prompt-actions");
  let choose: ((choice: ClearChoice) => void) | null = null;
  let saving = false;

  const pick = (choice: ClearChoice) => {
    if (choose === null || saving) {
      return;
    }

    if (choice === "save") {
      saving = true;
      setDisabled(true);
    }

    choose(choice);
  };
  const cancel = button("Cancel", "clear-prompt-cancel", () => pick("cancel"));
  const discard = button("Don't save", "clear-prompt-discard", () =>
    pick("discard"),
  );
  const save = button("Save", "clear-prompt-save", () => pick("save"));

  function setDisabled(disabled: boolean) {
    cancel.disabled = disabled;
    discard.disabled = disabled;
    save.disabled = disabled;
  }

  element.hidden = true;
  element.setAttribute("role", "dialog");
  save.classList.add("primary");
  actions.append(cancel, discard, save);
  element.append(heading, body, actions);
  element.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      pick("cancel");
    } else if (
      event.key === "Enter" &&
      event.target !== cancel &&
      event.target !== discard
    ) {
      event.preventDefault();
      event.stopPropagation();
      pick("save");
    }
  });

  return {
    element,
    show(name, next) {
      choose = next;
      saving = false;
      heading.textContent = `Save changes to ${name}?`;
      setDisabled(false);
      element.hidden = false;
      save.focus();
    },
    hide() {
      choose = null;
      saving = false;
      element.hidden = true;
      setDisabled(false);
    },
  };
}
