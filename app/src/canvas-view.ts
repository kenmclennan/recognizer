import { isEditable, type KeyAction, keyAction } from "./canvas-keys";
import type { Point, Rect } from "./canvas-layout";
import type { Scene } from "./canvas-scene";
import type { Selection } from "./canvas-state";
import { button, el } from "./dom";
import type { EvidenceSection } from "./edge-evidence";
import { buildLegendView } from "./legend-view";
import { type BarModel, buildSelectionBar } from "./selection-bar-view";
import {
  atMax,
  atMin,
  centerOn,
  fitToBounds,
  panBy,
  type Viewport,
  zoomAt,
  zoomLabel,
} from "./viewport";
import { classifyWheel } from "./wheel-device";

export type CanvasProps = {
  scene: Scene | null;
  selection: Selection;
  highlight: Set<string> | null;
  bar: BarModel | null;
  titles: Map<string, string>;
  evidence: { id: string; sections: EvidenceSection[] } | null;
  open: number;
  total: number;
  treeHidden: boolean;
  showInferred: boolean;
  notice: string | null;
};

export type CanvasActions = {
  find: (id: string) => void;
  select: (selection: Selection) => void;
  takeOff: () => void;
  toggleFold: () => void;
  toggleFocus: () => void;
  clear: () => void;
  setShowInferred: (show: boolean) => void;
  toggleTree: () => void;
  measure: (text: string) => number;
};

export type CanvasView = {
  element: HTMLElement;
  render: (props: CanvasProps) => void;
  centerOn: (id: string) => void;
};

export const PINCH_SPEED = 0.01;
export const MOUSE_ZOOM_STEP = 1.15;
export const BUTTON_ZOOM_STEP = 1.25;
export const DRAG_THRESHOLD = 4;

const SVG = "http://www.w3.org/2000/svg";

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number> = {},
  text = "",
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag);

  for (const [name, value] of Object.entries(attributes)) {
    node.setAttribute(name, String(value));
  }

  node.textContent = text;

  return node;
}

export function createMeasure(): (text: string) => number {
  const context = document.createElement("canvas").getContext("2d");
  const cache = new Map<string, number>();

  if (context) {
    context.font = `12px ${getComputedStyle(document.body).fontFamily}`;
  }

  return (text) => {
    const known = cache.get(text);

    if (known !== undefined) {
      return known;
    }

    const width = context?.measureText(text).width ?? text.length * 7;

    cache.set(text, width);

    return width;
  };
}

const points = (list: Point[]) => list.map((p) => `${p.x},${p.y}`).join(" ");

export function buildCanvasView(actions: CanvasActions): CanvasView {
  const element = el("main", "canvas");
  const bar = el("div", "canvas-bar");
  const toggle = button("", "tree-toggle", actions.toggleTree);
  const count = el("span", "count");
  const stage = el("div", "stage");
  const surface = svg("svg", { class: "surface" });
  const world = svg("g", { class: "world" });
  const popover = el("div", "popover");
  const controls = el("div", "controls");
  const empty = el("p", "empty-canvas", "Nothing on the canvas yet");
  const notice = el("p", "canvas-notice");
  const legend = buildLegendView((show) => actions.setShowInferred(show));
  const selectionBar = buildSelectionBar({
    takeOff: () => actions.takeOff(),
    toggleFocus: () => actions.toggleFocus(),
    toggleFold: () => actions.toggleFold(),
  });

  let props: CanvasProps | null = null;
  let viewport: Viewport = { x: 0, y: 0, k: 1 };
  let hadContent = false;
  let legendOpen = false;
  let pointerAnchor: Point | null = null;
  let popoverAt: Point | null = null;
  let pendingCenter: string | null = null;
  let gesture = false;
  let lastScale = 1;
  let drag: { start: Point; origin: Point; moved: boolean } | null = null;

  const zoomOut = button("-", "control", () => zoomBy(1 / BUTTON_ZOOM_STEP));
  const level = el("span", "level");
  const zoomIn = button("+", "control", () => zoomBy(BUTTON_ZOOM_STEP));
  const fitButton = button("Fit", "control", () => fitNow());
  const clearButton = button("Clear", "control", () => {
    viewport = { x: 0, y: 0, k: 1 };
    hadContent = false;
    actions.clear();
  });
  const legendButton = button("Legend", "control", () => {
    legendOpen = !legendOpen;
    refreshChrome();
  });

  zoomOut.title = "Zoom out";
  zoomIn.title = "Zoom in";
  surface.append(world);
  stage.append(surface, empty, notice, selectionBar.element, popover);
  controls.append(zoomOut, level, zoomIn, fitButton, clearButton, legendButton);
  bar.append(toggle, count);
  element.append(bar, stage, controls, legend.element);
  popover.hidden = true;

  function size() {
    const box = stage.getBoundingClientRect();

    return { width: box.width, height: box.height };
  }

  function localPoint(event: { clientX: number; clientY: number }): Point {
    const box = stage.getBoundingClientRect();

    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  function applyViewport() {
    world.setAttribute(
      "transform",
      `translate(${viewport.x} ${viewport.y}) scale(${viewport.k})`,
    );
    level.textContent = zoomLabel(viewport);
    zoomOut.disabled = atMin(viewport);
    zoomIn.disabled = atMax(viewport);
    positionBar();
  }

  function zoomBy(factor: number, at?: Point) {
    const s = size();

    viewport = zoomAt(
      viewport,
      factor,
      at ?? { x: s.width / 2, y: s.height / 2 },
    );
    applyViewport();
  }

  function fitNow() {
    if (props?.scene) {
      viewport = fitToBounds(props.scene.bounds, size());
      applyViewport();
    }
  }

  function rectOf(id: string): Rect | null {
    const scene = props?.scene;

    return (
      scene?.boxes.find((box) => box.id === id)?.rect ??
      scene?.frames.find((frame) => frame.path === id)?.rect ??
      null
    );
  }

  function anchorRect(): Rect | null {
    const selection = props?.selection;

    if (!selection || selection.kind === "edge") {
      return null;
    }

    const frame = props?.scene?.frames.find((f) => f.path === selection.id);

    return frame ? frame.labelRect : rectOf(selection.id);
  }

  function positionBar() {
    if (!props?.bar) {
      return;
    }

    const rect = anchorRect();
    const width = selectionBar.element.offsetWidth;
    const s = size();
    let at: Point;

    if (pointerAnchor) {
      at = pointerAnchor;
    } else if (rect) {
      at = {
        x: viewport.x + (rect.x + rect.width / 2) * viewport.k - width / 2,
        y: viewport.y + rect.y * viewport.k - 40,
      };
    } else {
      return;
    }

    const x = Math.max(4, Math.min(at.x, Math.max(4, s.width - width - 4)));
    const y = Math.max(4, at.y);

    selectionBar.element.style.left = `${x}px`;
    selectionBar.element.style.top = `${y}px`;
  }

  function refreshChrome() {
    legend.render(legendOpen, props?.showInferred ?? true);
    legendButton.classList.toggle("on", legendOpen);
  }

  function renderPopover() {
    const evidence = props?.evidence;
    const selected = props?.selection;

    if (
      !evidence ||
      selected?.kind !== "edge" ||
      selected.id !== evidence.id ||
      popoverAt === null
    ) {
      popover.hidden = true;

      return;
    }

    popover.replaceChildren(
      ...evidence.sections.map((section) => {
        const block = el("div", "evidence");

        block.append(
          el("div", "where", section.where),
          el("code", "quoted", section.quoted),
        );

        if (section.names) {
          block.append(el("div", "", `names: ${section.names}`));
        }

        if (section.route) {
          block.append(el("div", "", `via: ${section.route}`));
        }

        for (const part of section.inferred) {
          block.append(el("div", "", part));
        }

        return block;
      }),
    );
    popover.style.left = `${popoverAt.x}px`;
    popover.style.top = `${popoverAt.y}px`;
    popover.hidden = false;
  }

  function drawScene(scene: Scene) {
    const parts: SVGElement[] = [];

    for (const layer of scene.drawOrder) {
      const group = svg("g", { class: layer });

      if (layer === "frames") {
        for (const frame of scene.frames) {
          const { rect, labelRect } = frame;
          const node = svg("g", { class: "frame", "data-kind": "frame" });

          node.append(
            svg("rect", {
              class: "frame-body",
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              rx: 6,
            }),
            svg("rect", {
              class: "frame-label",
              "data-kind": "folder",
              "data-id": frame.path,
              x: labelRect.x,
              y: labelRect.y,
              width: labelRect.width,
              height: labelRect.height,
              rx: 6,
            }),
            svg("circle", {
              class: `disc-fill ${frame.disc}`,
              cx: rect.x + 12 + 5,
              cy: rect.y + 14,
              r: 5,
            }),
            svg(
              "text",
              { class: "name", x: rect.x + 30, y: rect.y + 18 },
              frame.label,
            ),
            svg(
              "text",
              {
                class: "figure",
                x: rect.x + 30 + actions.measure(frame.label) + 8,
                y: rect.y + 18,
              },
              frame.figure,
            ),
          );
          group.append(node);
        }
      } else if (layer === "lines") {
        for (const line of scene.lines) {
          const node = svg("g", { class: "line-group", "data-line": line.id });
          const hit = svg("polyline", {
            class: "line-hit",
            "data-kind": "edge",
            "data-id": line.id,
            points: points(line.points),
          });
          const stroke = svg("polyline", {
            class: `edge ${line.style}`,
            points: points(line.points),
          });
          const arrow = scene.arrows.find((a) => a.lineId === line.id);
          const title = props?.titles.get(line.id);

          if (line.dash) {
            stroke.setAttribute("stroke-dasharray", line.dash);
          }

          if (title) {
            hit.append(svg("title", {}, title));
          }

          node.append(stroke);

          if (arrow) {
            node.append(
              svg("polygon", {
                class: arrow.hollow ? "arrow hollow" : "arrow",
                points: points(arrow.points),
              }),
            );
          }

          if (line.countAt) {
            node.append(
              svg(
                "text",
                {
                  class: "count-label",
                  x: line.countAt.x + 4,
                  y: line.countAt.y,
                },
                String(line.count),
              ),
            );
          }

          node.append(hit);
          group.append(node);
        }
      } else {
        for (const box of scene.boxes) {
          const { rect } = box;
          const node = svg("g", {
            class: `box ${box.kind}`,
            "data-kind": "module",
            "data-id": box.id,
          });

          node.append(
            svg("rect", {
              class: "box-body",
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              rx: 5,
            }),
            svg("circle", {
              class: `disc-fill ${box.disc}`,
              cx: rect.x + 10 + 5,
              cy: rect.y + rect.height / 2,
              r: 5,
            }),
            svg(
              "text",
              {
                class: "name",
                x: rect.x + 28,
                y: rect.y + rect.height / 2 + 4,
              },
              box.label,
            ),
          );

          if (box.figures) {
            node.append(
              svg(
                "text",
                {
                  class: "figure",
                  x: rect.x + rect.width - 10,
                  y: rect.y + rect.height / 2 + 4,
                  "text-anchor": "end",
                },
                box.figures,
              ),
            );
          }

          group.append(node);
        }
      }

      parts.push(group);
    }

    world.replaceChildren(...parts);
  }

  function applySelection() {
    const selection = props?.selection ?? null;
    const highlight = props?.highlight ?? null;

    for (const group of world.querySelectorAll<SVGElement>(".line-group")) {
      const id = group.dataset.line as string;
      const lit = highlight?.has(id) ?? false;

      group.classList.toggle("highlight", lit);
      group.classList.toggle("dim", highlight !== null && !lit);
      group.classList.toggle(
        "selected",
        selection?.kind === "edge" && selection.id === id,
      );
    }

    for (const node of world.querySelectorAll<SVGElement>("[data-id]")) {
      const kind = node.dataset.kind;
      const isFolder = kind === "folder";
      const chosen =
        selection !== null &&
        selection.id === node.dataset.id &&
        (selection.kind === "folder") === isFolder &&
        kind !== "edge";

      node.classList.toggle("selected", chosen);
    }

    for (const node of world.querySelectorAll<SVGElement>(".box")) {
      const chosen =
        selection !== null &&
        selection.kind !== "edge" &&
        selection.id === node.dataset.id;

      node.classList.toggle("selected", chosen);
    }
  }

  function targetOf(event: Event): { kind: string; id: string } | null {
    const node = (event.target as Element | null)?.closest<SVGElement>(
      "[data-kind][data-id]",
    );

    return node
      ? { kind: node.dataset.kind as string, id: node.dataset.id as string }
      : null;
  }

  function choose(event: MouseEvent, target: { kind: string; id: string }) {
    pointerAnchor = event.type === "contextmenu" ? localPoint(event) : null;
    popoverAt = localPoint(event);

    if (target.kind === "edge") {
      actions.select({ kind: "edge", id: target.id });
    } else if (target.kind === "folder") {
      actions.select({ kind: "folder", id: target.id });
    } else {
      actions.select({ kind: "module", id: target.id });
    }
  }

  surface.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || targetOf(event)) {
      return;
    }

    drag = {
      start: { x: event.clientX, y: event.clientY },
      origin: { x: viewport.x, y: viewport.y },
      moved: false,
    };
    surface.setPointerCapture(event.pointerId);
  });

  surface.addEventListener("pointermove", (event) => {
    if (!drag) {
      return;
    }

    const dx = event.clientX - drag.start.x;
    const dy = event.clientY - drag.start.y;

    if (Math.hypot(dx, dy) >= DRAG_THRESHOLD) {
      drag.moved = true;
    }

    if (drag.moved) {
      viewport = { ...viewport, x: drag.origin.x + dx, y: drag.origin.y + dy };
      applyViewport();
    }
  });

  surface.addEventListener("pointerup", (event) => {
    if (!drag) {
      return;
    }

    const moved = drag.moved;

    drag = null;
    surface.releasePointerCapture(event.pointerId);

    if (!moved) {
      pointerAnchor = null;
      actions.select(null);
    }
  });

  surface.addEventListener("click", (event) => {
    const target = targetOf(event);

    if (target) {
      choose(event, target);
    }
  });

  surface.addEventListener("contextmenu", (event) => {
    event.preventDefault();

    const target = targetOf(event);

    if (target) {
      choose(event, target);
    }
  });

  stage.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();

      const at = localPoint(event);
      const kind = classifyWheel(event);

      if (kind === "pinch") {
        if (!gesture) {
          zoomBy(Math.exp(-event.deltaY * PINCH_SPEED), at);
        }
      } else if (kind === "mouse-wheel") {
        zoomBy(event.deltaY < 0 ? MOUSE_ZOOM_STEP : 1 / MOUSE_ZOOM_STEP, at);
      } else {
        viewport = panBy(viewport, -event.deltaX, -event.deltaY);
        applyViewport();
      }
    },
    { passive: false },
  );

  type GestureEvent = Event & {
    scale: number;
    clientX: number;
    clientY: number;
  };

  stage.addEventListener("gesturestart", (event) => {
    event.preventDefault();
    gesture = true;
    lastScale = 1;
  });
  stage.addEventListener("gesturechange", (event) => {
    event.preventDefault();

    const e = event as GestureEvent;

    zoomBy(e.scale / lastScale, localPoint(e));
    lastScale = e.scale;
  });
  stage.addEventListener("gestureend", (event) => {
    event.preventDefault();
    gesture = false;
  });

  document.addEventListener("click", (event) => {
    if (popoverAt !== null && !popover.contains(event.target as Node)) {
      popoverAt = null;
      popover.hidden = true;
    }
  });

  function perform(action: KeyAction) {
    if (action === "escape") {
      if (legendOpen) {
        legendOpen = false;
        refreshChrome();
      } else if (!popover.hidden) {
        popoverAt = null;
        popover.hidden = true;
      } else {
        actions.select(null);
      }
    } else if (action === "focus") {
      actions.toggleFocus();
    } else if (action === "fold") {
      actions.toggleFold();
    } else {
      actions.takeOff();
    }
  }

  document.addEventListener("keydown", (event) => {
    const action = keyAction(
      {
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        targetEditable: isEditable(event.target),
      },
      props?.selection ?? null,
    );

    if (action) {
      event.preventDefault();
      perform(action);
    }
  });

  function centerNow(id: string): boolean {
    const rect = rectOf(id);

    if (!rect) {
      return false;
    }

    viewport = centerOn(viewport, rect, size());
    applyViewport();

    return true;
  }

  return {
    element,
    centerOn(id) {
      if (!centerNow(id)) {
        pendingCenter = id;
      }
    },
    render(next) {
      const previous = props;

      props = next;
      toggle.textContent = next.treeHidden ? "Show tree" : "Hide tree";
      count.textContent = `${next.open} of ${next.total}`;
      empty.hidden = next.open > 0;
      notice.textContent = next.notice ?? "";
      notice.hidden = next.notice === null;

      const scene = next.scene;
      const has = (scene?.boxes.length ?? 0) > 0;

      if (scene !== previous?.scene || next.titles !== previous?.titles) {
        if (scene) {
          drawScene(scene);
        } else {
          world.replaceChildren();
        }

        if (has && !hadContent) {
          fitNow();
        }

        if (!has) {
          viewport = { x: 0, y: 0, k: 1 };
        }

        hadContent = has;
      }

      if (pendingCenter !== null && centerNow(pendingCenter)) {
        pendingCenter = null;
      }

      if (next.selection === null) {
        pointerAnchor = null;
      }

      applySelection();
      selectionBar.render(next.bar);
      renderPopover();
      refreshChrome();
      applyViewport();
    },
  };
}
