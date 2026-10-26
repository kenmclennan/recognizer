import { button, el } from "./dom";
import type { Disc, NodeHealth } from "./health";
import { icon, iconButton } from "./icons";
import type { Filtered, FilterState } from "./tree-filter";
import { type FolderNode, filesOf, type TreeNode } from "./tree-model";

export type TreeProps = {
  title: string;
  moduleCount: number;
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
  findFolder: (path: string) => void;
  hideTree: () => void;
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
  const header = el("div", "tree-header");
  const title = el("b", "tree-title");
  const count = el("span", "tree-count");
  const hide = iconButton(
    "panel",
    "Hide the tree",
    "tree-hide",
    actions.hideTree,
  );
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

  header.append(title, count, el("span", "spacer"), hide);
  find.type = "text";
  find.placeholder = "Find a file";
  find.autocomplete = "off";
  find.setAttribute("aria-label", "Find a file");
  find.addEventListener("input", () => actions.setText(find.value));
  filters.append(onCanvas, attention);

  for (const entry of LEGEND) {
    const item = el("span", "legend-item");

    item.append(disc(entry.disc, entry.label), el("span", "", entry.label));
    legend.append(item);
  }

  element.append(header, find, filters, list, legend);

  function row(node: TreeNode, depth: number, props: TreeProps): HTMLElement[] {
    const health = props.described.get(node.path);
    const line = el("div", `row ${node.kind}`);

    line.dataset.path = node.path;
    line.style.paddingLeft = `${depth * 14 + 4 + (node.kind === "file" ? 18 : 0)}px`;

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

    const holding = filesOf(node).some((file) => props.isOpen(file.path));
    const actionsBox = el("span", "actions");

    line.classList.toggle("ancestor", inside);
    line.classList.toggle("selected", props.selected === node.path);
    line.classList.toggle("on", holding);
    line.addEventListener("click", () => actions.toggleFolder(node.path));

    if (holding) {
      actionsBox.append(
        iconButton("target", "Find on canvas", "", () =>
          actions.findFolder(node.path),
        ),
      );
    }

    line.append(
      icon(open ? "chevron-down" : "chevron-right", "chevron"),
      disc(health?.disc ?? "grey", health?.hover ?? ""),
      el("span", "name", `${node.name}/`),
      actionsBox,
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
    line.classList.toggle("on", open);
    line.addEventListener("click", () =>
      open ? actions.find(node.path) : actions.putOnCanvas(node.path),
    );
    hover.append(
      ...(open
        ? [
            iconButton("target", "Find on canvas", "", () =>
              actions.find(node.path),
            ),
            iconButton("eye", "Take off the canvas", "vis", () =>
              actions.takeOff(node.path),
            ),
          ]
        : [
            iconButton("plus", "Put on the canvas", "", () =>
              actions.putOnCanvas(node.path),
            ),
          ]),
    );
    line.append(
      disc(health?.disc ?? "grey", health?.hover ?? ""),
      el("span", "name", node.name),
      hover,
    );

    return line;
  }

  return {
    element,
    render(props) {
      title.textContent = props.title;
      count.textContent = String(props.moduleCount);
      onCanvas.classList.toggle("on", props.filter.onCanvas);
      attention.classList.toggle("on", props.filter.needsAttention);

      const rows = props.filtered.root.children.flatMap((child) =>
        row(child, 0, props),
      );

      list.replaceChildren(
        ...(props.filtered.fileCount === 0 && props.filtered.active
          ? [el("p", "empty", "Nothing matches.")]
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
