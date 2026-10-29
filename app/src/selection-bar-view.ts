import { el } from "./dom";
import { type IconName, icon } from "./icons";
import type { InspectorTab } from "./inspector-model";

export type BarModel = {
  kind: "module" | "folder";
  dependencies: number;
  files: { open: number; held: number } | null;
  focused: boolean;
  folded: boolean;
  inspectorTab: InspectorTab | null;
};

export type BarActions = {
  openTab: (tab: InspectorTab) => void;
  toggleFocus: () => void;
  toggleFold: () => void;
  openContents: () => void;
  takeOff: () => void;
};

export type SelectionBarView = {
  element: HTMLElement;
  render: (model: BarModel | null) => void;
};

function iconButton(
  name: IconName,
  title: string,
  onClick: (() => void) | null,
  figure: string | null = null,
): HTMLButtonElement {
  const node = el("button", "bar-button");

  node.type = "button";
  node.title = title;
  node.setAttribute("aria-label", title);
  node.append(icon(name));

  if (figure !== null) {
    node.append(el("span", "bar-figure", figure));
  }

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

const separator = () => el("span", "bar-sep");

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

      const contentsShown =
        model.inspectorTab === "contents" || model.inspectorTab === "findings";
      const parts: HTMLElement[] = [];

      if (model.files) {
        const files = iconButton(
          "folder",
          "Pick files in it (I)",
          () => actions.openTab("contents"),
          `${model.files.open}/${model.files.held}`,
        );

        files.classList.toggle("on", contentsShown);
        parts.push(files, separator());
      }

      const dependencies = iconButton(
        "dependencies",
        "Dependencies (D)",
        model.dependencies > 0 ? () => actions.openTab("dependencies") : null,
        String(model.dependencies),
      );

      dependencies.classList.toggle(
        "on",
        model.inspectorTab === "dependencies",
      );
      parts.push(dependencies, separator());

      if (model.kind === "folder") {
        parts.push(
          iconButton(
            "focus",
            model.focused ? "Unfocus (F)" : "Only this folder (F)",
            () => actions.toggleFocus(),
          ),
          iconButton(
            model.folded ? "unfold" : "fold",
            model.folded ? "Unfold (Z)" : "Fold into one box (Z)",
            () => actions.toggleFold(),
          ),
        );
      }

      const contents = iconButton("list", "Contents (I)", () =>
        actions.openContents(),
      );

      contents.classList.toggle("on", contentsShown);
      parts.push(
        contents,
        separator(),
        iconButton("take-off", "Take off the canvas (Backspace)", () =>
          actions.takeOff(),
        ),
      );
      element.replaceChildren(...parts);
    },
  };
}
