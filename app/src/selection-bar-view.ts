import { el } from "./dom";
import { type IconName, icon } from "./icons";
import type { InspectorTab } from "./inspector-model";

export type BarModel = {
  kind: "module" | "folder";
  uses: number;
  usedBy: number;
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

      const contentsShown =
        model.inspectorTab === "contents" || model.inspectorTab === "findings";
      const tab = (
        target: InspectorTab,
        title: string,
        enabled: boolean,
        lit: boolean,
        ...children: (string | Node)[]
      ): HTMLButtonElement => {
        const node = barButton(
          title,
          enabled ? () => actions.openTab(target) : null,
          ...children,
        );

        node.classList.toggle("on", lit);

        return node;
      };
      const parts: HTMLElement[] = [];

      if (model.files) {
        parts.push(
          tab(
            "contents",
            "Pick files in it",
            true,
            contentsShown,
            `Files ${model.files.open} of ${model.files.held}`,
            chevron(),
          ),
          separator(),
        );
      }

      parts.push(
        tab(
          "uses",
          "Pick what it uses (U)",
          model.uses > 0,
          model.inspectorTab === "uses",
          icon("arrow-down"),
          `Uses ${model.uses}`,
          chevron(),
        ),
        tab(
          "usedBy",
          "Pick what uses it (D)",
          model.usedBy > 0,
          model.inspectorTab === "usedBy",
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

      const contents = iconButton("list", "Contents", "Contents (I)", () =>
        actions.openContents(),
      );

      contents.classList.toggle("on", contentsShown);
      parts.push(contents);
      parts.push(
        separator(),
        iconButton(
          "take-off",
          "Take off the canvas (Backspace)",
          "Take off the canvas (Backspace)",
          () => actions.takeOff(),
        ),
      );
      element.replaceChildren(...parts);
    },
  };
}
