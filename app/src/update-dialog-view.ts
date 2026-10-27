import {
  canDismiss,
  type DialogState,
  dialogButtons,
  dialogError,
  dialogMessage,
} from "./update-dialog";

export type UpdateDialogDeps = {
  currentVersion: () => Promise<string>;
  upgrade: () => void;
};

export type UpdateDialogView = {
  show: (state: DialogState) => void;
  isOpen: () => boolean;
  close: () => void;
  dismiss: () => boolean;
};

export function buildUpdateDialog(
  container: HTMLElement,
  deps: UpdateDialogDeps,
): UpdateDialogView {
  const panel = document.createElement("div");
  let state: DialogState = { kind: "checking" };
  let current = "";

  panel.className = "update-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "Check for Updates");
  container.replaceChildren(panel);
  container.addEventListener("pointerdown", (event) => {
    if (event.target === container) {
      dismiss();
    }
  });

  function close(): void {
    container.hidden = true;
  }

  function dismiss(): boolean {
    if (container.hidden || !canDismiss(state)) {
      return false;
    }

    close();

    return true;
  }

  function render(): void {
    const message = document.createElement("p");
    const actions = document.createElement("div");
    const error = dialogError(state);

    message.className = "update-message";
    message.textContent = dialogMessage(state, current);
    actions.className = "update-actions";

    for (const kind of dialogButtons(state)) {
      const button = document.createElement("button");

      button.type = "button";
      button.textContent = kind === "upgrade" ? "Upgrade" : "Close";
      button.className = kind === "upgrade" ? "primary" : "";
      button.addEventListener("click", () =>
        kind === "upgrade" ? deps.upgrade() : close(),
      );
      actions.append(button);
    }

    panel.replaceChildren(message);

    if (error !== null) {
      const failure = document.createElement("p");

      failure.className = "update-error";
      failure.textContent = `Update failed: ${error}`;
      panel.append(failure);
    }

    panel.append(actions);
    actions.querySelector("button")?.focus();
  }

  return {
    show(next) {
      state = next;
      container.hidden = false;
      render();

      if (current === "") {
        void deps.currentVersion().then((version) => {
          current = version;

          if (!container.hidden) {
            render();
          }
        });
      }
    },
    isOpen: () => !container.hidden,
    close,
    dismiss,
  };
}
