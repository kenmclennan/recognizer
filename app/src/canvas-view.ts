import { button, el } from "./dom";

export type CanvasProps = {
  opened: string[];
  total: number;
  selected: string | null;
  treeHidden: boolean;
};

export type CanvasActions = {
  find: (id: string) => void;
  takeOff: (id: string) => void;
  toggleTree: () => void;
};

export type CanvasView = {
  element: HTMLElement;
  render: (props: CanvasProps) => void;
};

export function buildCanvasView(actions: CanvasActions): CanvasView {
  const element = el("main", "canvas");
  const bar = el("div", "canvas-bar");
  const toggle = button("", "tree-toggle", actions.toggleTree);
  const count = el("span", "count");
  const list = el("ul", "open-list");

  toggle.title = "Show or hide the tree (Cmd/Ctrl+B)";
  bar.append(toggle, count);
  element.append(bar, list);

  return {
    element,
    render(props) {
      toggle.textContent = props.treeHidden ? "Show tree" : "Hide tree";
      count.textContent = `${props.opened.length} of ${props.total}`;

      if (props.opened.length === 0) {
        list.replaceChildren(el("li", "empty", "Nothing on the canvas yet"));

        return;
      }

      list.replaceChildren(
        ...props.opened.map((id) => {
          const item = el(
            "li",
            props.selected === id ? "open-item selected" : "open-item",
          );
          const path = button(id, "path", () => actions.find(id));

          item.append(
            path,
            button("Take off", "action", () => actions.takeOff(id)),
          );

          return item;
        }),
      );
    },
  };
}
