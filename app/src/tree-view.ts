import { button, el } from "./dom";
import type { Disc, NodeHealth } from "./health";
import type { Filtered, FilterState } from "./tree-filter";
import type { FolderNode, TreeNode } from "./tree-model";

export type TreeProps = {
  filtered: Filtered;
  described: Map<string, NodeHealth>;
  expanded: Set<string>;
  selected: string | null;
  isOpen: (id: string) => boolean;
  filter: FilterState;
};

export type TreeActions = {
  setText: (text: string) => void;
  toggleOnCanvas: () => void;
  toggleNeedsAttention: () => void;
  toggleFolder: (path: string) => void;
  putOnCanvas: (id: string) => void;
  takeOff: (id: string) => void;
  find: (id: string) => void;
};

export type TreeView = {
  element: HTMLElement;
  render: (props: TreeProps) => void;
  scrollTo: (id: string) => void;
};

const LEGEND: { disc: Disc; label: string }[] = [
  { disc: "green", label: "fine" },
  { disc: "amber", label: "warning" },
  { disc: "red", label: "violation" },
  { disc: "grey", label: "not measured" },
];

function disc(kind: Disc, hover: string): HTMLElement {
  const node = el("span", `disc disc-${kind}`);

  node.title = hover;

  return node;
}

export function buildTreeView(actions: TreeActions): TreeView {
  const element = el("aside", "tree");
  const find = el("input", "find");
  const onCanvas = button("On canvas", "toggle", actions.toggleOnCanvas);
  const attention = button(
    "Needs attention",
    "toggle",
    actions.toggleNeedsAttention,
  );
  const filters = el("div", "filters");
  const list = el("div", "rows");
  const legend = el("div", "legend");

  find.type = "search";
  find.placeholder = "Find by path";
  find.addEventListener("input", () => actions.setText(find.value));
  filters.append(onCanvas, attention);

  for (const entry of LEGEND) {
    const item = el("span", "legend-item");

    item.append(disc(entry.disc, entry.label), el("span", "", entry.label));
    legend.append(item);
  }

  element.append(find, filters, list, legend);

  function row(node: TreeNode, depth: number, props: TreeProps): HTMLElement[] {
    const health = props.described.get(node.path);
    const line = el("div", `row ${node.kind}`);

    line.dataset.path = node.path;
    line.style.paddingLeft = `${8 + depth * 14}px`;

    if (node.kind === "file") {
      return [fileRow(line, node, health, props)];
    }

    const open = props.filtered.active || props.expanded.has(node.path);
    const rows = [folderRow(line, node, open, health, props)];

    if (open) {
      for (const child of node.children) {
        rows.push(...row(child, depth + 1, props));
      }
    }

    return rows;
  }

  function folderRow(
    line: HTMLElement,
    node: FolderNode,
    open: boolean,
    health: NodeHealth | undefined,
    props: TreeProps,
  ): HTMLElement {
    const inside = props.selected?.startsWith(`${node.path}/`) ?? false;

    line.classList.toggle("ancestor", inside);
    line.addEventListener("click", () => actions.toggleFolder(node.path));
    line.append(
      el("span", "chevron", open ? "▾" : "▸"),
      disc(health?.disc ?? "grey", health?.hover ?? ""),
      el("span", "name", node.name),
    );

    return line;
  }

  function fileRow(
    line: HTMLElement,
    node: TreeNode,
    health: NodeHealth | undefined,
    props: TreeProps,
  ): HTMLElement {
    const open = props.isOpen(node.path);
    const hover = el("span", "actions");

    line.classList.toggle("selected", props.selected === node.path);
    hover.append(
      ...(open
        ? [
            button("Find on canvas", "action", () => actions.find(node.path)),
            button("Take off", "action", () => actions.takeOff(node.path)),
          ]
        : [
            button("Put on canvas", "action", () =>
              actions.putOnCanvas(node.path),
            ),
          ]),
    );
    line.append(
      el("span", "chevron"),
      disc(health?.disc ?? "grey", health?.hover ?? ""),
      el("span", "name", node.name),
      hover,
    );

    return line;
  }

  return {
    element,
    render(props) {
      onCanvas.classList.toggle("on", props.filter.onCanvas);
      attention.classList.toggle("on", props.filter.needsAttention);

      const rows = props.filtered.root.children.flatMap((child) =>
        row(child, 0, props),
      );

      list.replaceChildren(
        ...(props.filtered.fileCount === 0 && props.filtered.active
          ? [el("p", "empty", "No matches")]
          : rows),
      );
    },
    scrollTo(id) {
      const target = [...list.querySelectorAll<HTMLElement>(".row")].find(
        (row) => row.dataset.path === id,
      );

      target?.scrollIntoView({ block: "nearest" });
    },
  };
}
