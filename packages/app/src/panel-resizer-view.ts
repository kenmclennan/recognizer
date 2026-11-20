import { el } from "./dom";
import {
  dragWidth,
  loadWidths,
  type PanelName,
  type PanelWidths,
  saveWidths,
} from "./panel-widths";

export type PanelResizerHandlers = {
  read: () => number;
  write: (px: number) => void;
  commit: () => void;
  count?: () => number;
  clampAs?: () => PanelName;
};

export function buildPanelResizer(
  panel: PanelName,
  handlers: PanelResizerHandlers,
): HTMLElement {
  const node = el("div", `panel-resizer panel-resizer-${panel}`);
  let drag: { startWidth: number; startX: number; count: number } | null = null;

  node.setAttribute("role", "separator");
  node.setAttribute("aria-orientation", "vertical");
  node.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    node.setPointerCapture(event.pointerId);
    drag = {
      startWidth: handlers.read(),
      startX: event.clientX,
      count: handlers.count?.() ?? 1,
    };
  });
  node.addEventListener("pointermove", (event) => {
    if (drag !== null) {
      handlers.write(
        dragWidth(
          handlers.clampAs?.() ?? panel,
          drag.startWidth,
          drag.startX,
          event.clientX,
          drag.count,
        ),
      );
    }
  });

  const finish = (event: PointerEvent) => {
    if (drag === null) {
      return;
    }

    drag = null;
    node.releasePointerCapture(event.pointerId);
    handlers.commit();
  };

  node.addEventListener("pointerup", finish);
  node.addEventListener("pointercancel", finish);

  return node;
}

export type PanelResizerHooks = {
  shownPanels: () => number;
  committed: () => void;
  leftWidth?: () => "tree" | "commits";
};

export function mountPanelResizers(
  body: HTMLElement,
  panels: Record<"tree" | "inspector", HTMLElement>,
  storage: Pick<Storage, "getItem" | "setItem">,
  hooks: PanelResizerHooks = { shownPanels: () => 1, committed: () => {} },
): PanelWidths {
  const widths = loadWidths(storage);
  const leftKey = () => hooks.leftWidth?.() ?? "tree";
  const apply = (panel: "tree" | "inspector") =>
    body.style.setProperty(
      panel === "tree" ? "--tree-w" : "--inspector-w",
      `${widths[panel === "tree" ? leftKey() : panel]}px`,
    );

  for (const panel of ["tree", "inspector"] as const) {
    apply(panel);
    panels[panel].append(
      buildPanelResizer(panel, {
        read: () => widths[panel === "tree" ? leftKey() : panel],
        write: (px) => {
          widths[panel === "tree" ? leftKey() : panel] = px;
          apply(panel);
        },
        clampAs: panel === "tree" ? leftKey : undefined,
        commit() {
          saveWidths(storage, widths);
          hooks.committed();
        },
        count: panel === "inspector" ? hooks.shownPanels : undefined,
      }),
    );
  }

  return widths;
}
