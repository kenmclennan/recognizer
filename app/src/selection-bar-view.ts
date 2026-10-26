import { el } from "./dom";
import { type IconName, icon } from "./icons";

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

function barButton(
  title: string,
  onClick: (() => void) | null,
  ...children: (string | Node)[]
): HTMLButtonElement {
  const node = el("button", "bar-button");

  node.type = "button";
  node.title = title;
  node.append(...children);

  if (onClick) {
    node.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick();
    });
  } else {
    node.disabled = true;
  }

  return node;
}

function iconButton(
  name: IconName,
  label: string,
  title: string,
  onClick: (() => void) | null,
): HTMLButtonElement {
  const node = barButton(title, onClick, icon(name));

  node.setAttribute("aria-label", label);

  return node;
}

const separator = () => el("span", "bar-sep");
const chevron = () => icon("chevron-down", "small");

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
        title: string,
        enabled: boolean,
        ...children: (string | Node)[]
      ): HTMLButtonElement => {
        const node = barButton(
          title,
          enabled ? () => actions.togglePicker(kind) : null,
          ...children,
        );

        node.classList.toggle("on", model.picker === kind);

        return node;
      };
      const parts: HTMLElement[] = [];

      if (model.files) {
        parts.push(
          picker(
            "files",
            "Pick files in it",
            true,
            `Files ${model.files.open} of ${model.files.held}`,
            chevron(),
          ),
          separator(),
        );
      }

      parts.push(
        picker(
          "uses",
          "Pick what it uses (U)",
          model.uses > 0,
          icon("arrow-down"),
          `Uses ${model.uses}`,
          chevron(),
        ),
        picker(
          "usedBy",
          "Pick what uses it (D)",
          model.usedBy > 0,
          icon("arrow-up"),
          `Used by ${model.usedBy}`,
          chevron(),
        ),
        separator(),
      );

      if (model.kind === "folder") {
        parts.push(
          iconButton(
            "focus",
            model.focused ? "Unfocus" : "Focus on this folder",
            model.focused ? "Unfocus (F)" : "Only this folder (F)",
            () => actions.toggleFocus(),
          ),
          iconButton(
            model.folded ? "unfold" : "fold",
            model.folded ? "Unfold" : "Fold into one box",
            model.folded ? "Unfold (Z)" : "Fold into one box (Z)",
            () => actions.toggleFold(),
          ),
        );
      }

      parts.push(
        iconButton("list", "Contents", `Contents (I) - ${INSPECTOR}`, null),
        iconButton(
          "x",
          "Take off the canvas",
          "Take off the canvas (Backspace)",
          () => actions.takeOff(),
        ),
      );
      element.replaceChildren(...parts);
    },
  };
}
