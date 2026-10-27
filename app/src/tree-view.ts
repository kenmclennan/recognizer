import { button, el } from "./dom";
import type { NodeHealth } from "./health";
import { checkState, nextCheck } from "./row-model";
import { buildRow } from "./row-view";
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
  putFolderOnCanvas: (ids: string[]) => void;
  takeFolderOff: (ids: string[]) => void;
  find: (id: string) => void;
};

export type TreeView = {
  element: HTMLElement;
  render: (props: TreeProps) => void;
  scrollTo: (id: string) => void;
};

export function buildTreeView(actions: TreeActions): TreeView {
  const element = el("aside", "tree");
  const header = el("div", "tree-header");
  const title = el("b", "tree-title");
  const count = el("span", "tree-count");
  const find = el("input", "find");
  const onCanvas = button("On canvas", "toggle", actions.toggleOnCanvas);
  const attention = button(
    "Needs attention",
    "toggle",
    actions.toggleNeedsAttention,
  );
  const filters = el("div", "filters");
  const list = el("div", "rows");

  header.append(title, count);
  find.type = "text";
  find.placeholder = "Find a file";
  find.autocomplete = "off";
  find.setAttribute("aria-label", "Find a file");
  find.addEventListener("input", () => actions.setText(find.value));
  filters.append(onCanvas, attention);

  element.append(header, find, filters, list);

  function row(node: TreeNode, depth: number, props: TreeProps): HTMLElement[] {
    const health = props.described.get(node.path);
    const padding = `${depth * 14 + 4 + (node.kind === "file" ? 18 : 0)}px`;

    if (node.kind === "file") {
      return [fileRow(node, padding, health, props)];
    }

    const open = props.filtered.active || props.expanded.has(node.path);
    const rows = [folderRow(node, padding, open, health, props)];

    if (open) {
      for (const child of node.children) {
        rows.push(...row(child, depth + 1, props));
      }
    }

    return rows;
  }

  function folderRow(
    node: FolderNode,
    padding: string,
    open: boolean,
    health: NodeHealth | undefined,
    props: TreeProps,
  ): HTMLElement {
    const inside = props.selected?.startsWith(`${node.path}/`) ?? false;
    const files = filesOf(node).map((file) => file.path);
    const state = checkState(files, props.isOpen);
    const toggle = () => actions.toggleFolder(node.path);
    const line = buildRow({
      label: `${node.name}/`,
      state,
      bold: state !== "unchecked",
      disc: health?.disc ?? "grey",
      discHover: health?.hover,
      chevron: open ? "open" : "closed",
      onCheck: () =>
        nextCheck(state) === "takeOff"
          ? actions.takeFolderOff(files)
          : actions.putFolderOnCanvas(files),
      onName: toggle,
      onChevron: toggle,
    });

    line.classList.add("folder");
    line.classList.toggle("ancestor", inside);
    line.classList.toggle("selected", props.selected === node.path);
    line.dataset.path = node.path;
    line.style.paddingLeft = padding;

    return line;
  }

  function fileRow(
    node: TreeNode,
    padding: string,
    health: NodeHealth | undefined,
    props: TreeProps,
  ): HTMLElement {
    const open = props.isOpen(node.path);
    const line = buildRow({
      label: node.name,
      state: open ? "checked" : "unchecked",
      bold: open,
      disc: health?.disc ?? "grey",
      discHover: health?.hover,
      onCheck: () =>
        open ? actions.takeOff(node.path) : actions.putOnCanvas(node.path),
      onName: () => actions.find(node.path),
    });

    line.classList.add("file");
    line.classList.toggle("selected", props.selected === node.path);
    line.dataset.path = node.path;
    line.style.paddingLeft = padding;

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
