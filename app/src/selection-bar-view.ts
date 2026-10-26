import { button, el } from "./dom";

export type BarModel = {
  kind: "module" | "folder";
  uses: number;
  usedBy: number;
  files: { open: number; held: number } | null;
  focused: boolean;
  folded: boolean;
};

export type BarActions = {
  takeOff: () => void;
  toggleFocus: () => void;
  toggleFold: () => void;
};

export type SelectionBarView = {
  element: HTMLElement;
  render: (model: BarModel | null) => void;
};

const PICKER = "opens the picker in a later version";
const INSPECTOR = "opens the inspector in a later version";

function disabled(label: string, title: string): HTMLButtonElement {
  const node = button(label, "bar-button", () => {});

  node.disabled = true;
  node.title = title;

  return node;
}

export function buildSelectionBar(actions: BarActions): SelectionBarView {
  const element = el("div", "selection-bar");

  element.hidden = true;
  element.addEventListener("pointerdown", (event) => event.stopPropagation());
  element.addEventListener("click", (event) => event.stopPropagation());
  element.addEventListener("contextmenu", (event) => event.preventDefault());

  return {
    element,
    render(model) {
      element.hidden = model === null;

      if (model === null) {
        element.replaceChildren();

        return;
      }

      const buttons = [
        disabled(`Uses ${model.uses}`, PICKER),
        disabled(`Used by ${model.usedBy}`, PICKER),
      ];

      if (model.files) {
        buttons.push(
          disabled(`Files ${model.files.open} of ${model.files.held}`, PICKER),
        );
      }

      buttons.push(disabled("Contents", INSPECTOR));

      if (model.kind === "folder") {
        buttons.push(
          button(model.focused ? "Unfocus" : "Focus", "bar-button", () =>
            actions.toggleFocus(),
          ),
          button(model.folded ? "Unfold" : "Fold", "bar-button", () =>
            actions.toggleFold(),
          ),
        );
      }

      buttons.push(button("Take off", "bar-button", () => actions.takeOff()));
      element.replaceChildren(...buttons);
    },
  };
}
