import { button, el } from "./dom";

export type PickerKind = "uses" | "usedBy" | "files";

export type BarModel = {
  kind: "module" | "folder";
  uses: number;
  usedBy: number;
  files: { open: number; held: number } | null;
  focused: boolean;
  folded: boolean;
  picker: PickerKind | null;
};

export type BarActions = {
  togglePicker: (kind: PickerKind) => void;
  takeOff: () => void;
  toggleFocus: () => void;
  toggleFold: () => void;
};

export type SelectionBarView = {
  element: HTMLElement;
  render: (model: BarModel | null) => void;
};

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

      const picker = (
        kind: PickerKind,
        label: string,
        enabled: boolean,
      ): HTMLButtonElement => {
        const node = button(label, "bar-button", () =>
          actions.togglePicker(kind),
        );

        node.disabled = !enabled;
        node.classList.toggle("on", model.picker === kind);

        return node;
      };
      const buttons = [
        picker("uses", `Uses ${model.uses}`, model.uses > 0),
        picker("usedBy", `Used by ${model.usedBy}`, model.usedBy > 0),
      ];

      if (model.files) {
        buttons.push(
          picker(
            "files",
            `Files ${model.files.open} of ${model.files.held}`,
            true,
          ),
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
