import { button, el } from "./dom";

export type UnsavedChoice = "cancel" | "discard" | "save";

export type UnsavedDialogView = {
  element: HTMLElement;
  show: (
    name: string,
    body: string,
    choose: (choice: UnsavedChoice) => void,
  ) => void;
  hide: () => void;
};

export function buildUnsavedDialog(): UnsavedDialogView {
  const element = el("div", "unsaved-dialog-scrim");
  const dialog = el("div", "unsaved-dialog");
  const heading = el("p", "unsaved-dialog-heading");
  const body = el("p", "unsaved-dialog-body");
  const actions = el("div", "unsaved-dialog-actions");
  let choose: ((choice: UnsavedChoice) => void) | null = null;
  let saving = false;

  const pick = (choice: UnsavedChoice) => {
    if (choose === null || saving) {
      return;
    }

    if (choice === "save") {
      saving = true;
      setDisabled(true);
    }

    choose(choice);
  };
  const cancel = button("Cancel", "unsaved-dialog-cancel", () =>
    pick("cancel"),
  );
  const discard = button("Don't save", "unsaved-dialog-discard", () =>
    pick("discard"),
  );
  const save = button("Save", "unsaved-dialog-save", () => pick("save"));
  const order = [cancel, discard, save];

  function setDisabled(disabled: boolean) {
    cancel.disabled = disabled;
    discard.disabled = disabled;
    save.disabled = disabled;
  }

  element.hidden = true;
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  save.classList.add("primary");
  actions.append(cancel, discard, save);
  dialog.append(heading, body, actions);
  element.append(dialog);
  element.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      pick("cancel");
    } else if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();

      const at = order.indexOf(document.activeElement as HTMLButtonElement);
      const step = event.shiftKey ? -1 : 1;
      const next =
        at === -1
          ? (order[event.shiftKey ? order.length - 1 : 0] ?? save)
          : (order[(at + step + order.length) % order.length] ?? save);

      next.focus();
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
    show(name, text, next) {
      choose = next;
      saving = false;
      heading.textContent = `Save changes to ${name}?`;
      body.textContent = text;
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
