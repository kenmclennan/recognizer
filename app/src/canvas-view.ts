import { createBarHover, type Scheduler, timerScheduler } from "./bar-hover";
import {
  isEditable,
  type KeyAction,
  keyAction,
  type NoteKeyContext,
} from "./canvas-keys";
import type { Point, Rect } from "./canvas-layout";
import type { Scene } from "./canvas-scene";
import type { Selection } from "./canvas-state";
import { button, el } from "./dom";
import type { InspectorTab } from "./inspector-model";
import { buildLegendView } from "./legend-view";
import {
  cardLayout,
  FINDING_CARD_WIDTH,
  FINDING_CARD_WRAP,
} from "./notes-order";
import { type BarModel, buildSelectionBar } from "./selection-bar-view";
import { spinner } from "./spinner-view";
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
  neighbourhood?: Set<string> | null;
  trail?: ReadonlySet<string> | null;
  bar: BarModel | null;
  titles: Map<string, string>;
  open: number;
  total: number;
  showInferred: boolean;
  notice: string | null;
  busy?: boolean;
  notes?: CanvasNotes;
  orientation?: CanvasOrientation | null;
};

export type CanvasOrientation = {
  lit: ReadonlySet<string>;
  tone: "violation" | "warning";
  card: { module: string; lines: string[]; id: string } | null;
};

export type CanvasNotes = {
  marks: ReadonlySet<string>;
  active: string | null;
  card: { module: string; text: string; tint: "person" | "agent" } | null;
  keys: NoteKeyContext;
};

export type CanvasActions = {
  find: (id: string) => void;
  select: (selection: Selection) => void;
  takeOff: () => void;
  toggleFold: () => void;
  toggleFocus: () => void;
  clear: () => void;
  setShowInferred: (show: boolean) => void;
  measure: (text: string) => number;
  openTab: (tab: InspectorTab) => void;
  openContents: () => void;
  openInEditor: () => void;
  addNote: () => void;
  removeNote: () => void;
  walkNotes: (delta: 1 | -1) => void;
  walkFindings: (delta: 1 | -1) => void;
  openFinding: () => void;
  copyFindingId: () => void;
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

function frameText(rect: Rect, label: string, figure: string): SVGElement {
  const text = svg("text", {
    class: "frame-text",
    x: rect.x + 23,
    y: rect.y + 18,
  });

  text.append(
    svg("tspan", { class: "name" }, `${label}/`),
    " ",
    svg("tspan", { class: "cnt" }, figure),
  );

  return text;
}

const points = (list: Point[]) => list.map((p) => `${p.x},${p.y}`).join(" ");

export function buildCanvasView(
  actions: CanvasActions,
  scheduler: Scheduler = timerScheduler,
): CanvasView {
  const element = el("main", "canvas");
  const stage = el("div", "stage");
  const surface = svg("svg", { class: "surface" });
  const world = svg("g", { class: "world" });
  const controls = el("div", "controls");
  const empty = el("p", "empty-canvas");
  const notice = el("p", "canvas-notice");
  const busy = spinner("Laying out");

  busy.classList.add("canvas-busy");
  busy.hidden = true;
  const legend = buildLegendView((show) => actions.setShowInferred(show));
  const selectionBar = buildSelectionBar({
    openTab: (tab) => actions.openTab(tab),
    toggleFocus: () => actions.toggleFocus(),
    toggleFold: () => actions.toggleFold(),
    openContents: () => actions.openContents(),
    openInEditor: () => actions.openInEditor(),
    takeOff: () => actions.takeOff(),
  });

  const hover = createBarHover(scheduler, (visible) =>
    selectionBar.element.classList.toggle("away", !visible),
  );

  selectionBar.element.classList.add("away");
  selectionBar.element.addEventListener("pointerenter", () => hover.enter());
  selectionBar.element.addEventListener("pointerleave", () => hover.leave());

  let props: CanvasProps | null = null;
  let choosing = false;
  let shownSelection: string | null = null;
  let viewport: Viewport = { x: 0, y: 0, k: 1 };
  let hadContent = false;
  let legendOpen = false;
  let pointerAnchor: Point | null = null;
  let pendingCenter: string | null = null;
  let gesture = false;
  let lastScale = 1;
  let drag: { start: Point; origin: Point; moved: boolean } | null = null;

  const zoomOut = button("\u2212", "control", () =>
    zoomBy(1 / BUTTON_ZOOM_STEP),
  );
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

  empty.append(
    "Open a file from the tree to start.",
    document.createElement("br"),
    "Select a box, or a folder by its name, for its actions.",
  );
  zoomOut.title = "Zoom out";
  zoomOut.setAttribute("aria-label", "Zoom out");
  zoomIn.title = "Zoom in";
  zoomIn.setAttribute("aria-label", "Zoom in");
  surface.append(world);
  stage.append(surface, empty, notice, busy, selectionBar.element);
  controls.append(zoomOut, level, zoomIn, fitButton, clearButton, legendButton);
  element.append(stage, controls, legend.element);

  function size() {
    const box = stage.getBoundingClientRect();

    return { width: box.width, height: box.height };
  }

  function localPoint(event: { clientX: number; clientY: number }): Point {
    const box = stage.getBoundingClientRect();

    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  function canvasPoint(local: Point): Point {
    return {
      x: (local.x - viewport.x) / viewport.k,
      y: (local.y - viewport.y) / viewport.k,
    };
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
    let at: Point;

    if (pointerAnchor) {
      at = {
        x: viewport.x + pointerAnchor.x * viewport.k,
        y: viewport.y + pointerAnchor.y * viewport.k,
      };
    } else if (rect) {
      at = {
        x: viewport.x + (rect.x + rect.width / 2) * viewport.k - width / 2,
        y: viewport.y + rect.y * viewport.k - 40,
      };
    } else {
      return;
    }

    selectionBar.element.style.left = `${at.x}px`;
    selectionBar.element.style.top = `${at.y}px`;
  }

  function refreshChrome() {
    legend.render(legendOpen, props?.showInferred ?? true);
    legendButton.classList.toggle("on", legendOpen);
  }

  function drawScene(scene: Scene) {
    const parts: SVGElement[] = [];

    for (const layer of scene.drawOrder) {
      const group = svg("g", { class: layer });

      if (layer === "frames") {
        for (const frame of scene.frames) {
          const { rect, labelRect } = frame;
          const node = svg("g", {
            class: "frame",
            "data-kind": "frame",
            "data-path": frame.path,
          });

          node.append(
            svg("rect", {
              class: "frame-body",
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              rx: 8,
            }),
            svg("rect", {
              class: "frame-label",
              "data-kind": "folder",
              "data-id": frame.path,
              x: labelRect.x,
              y: labelRect.y,
              width: labelRect.width,
              height: labelRect.height,
            }),
            svg("circle", {
              class: `disc-fill ${frame.disc}`,
              cx: rect.x + 13,
              cy: rect.y + 14,
              r: 4,
            }),
            frameText(rect, frame.label, frame.figure),
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
            "data-kind": box.kind,
            "data-id": box.id,
          });

          const middle = rect.y + rect.height / 2;

          node.append(
            svg("rect", {
              class: "halo",
              x: rect.x - 3,
              y: rect.y - 3,
              width: rect.width + 6,
              height: rect.height + 6,
              rx: 10,
            }),
            svg("rect", {
              class: "box-body",
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              rx: 7,
            }),
            svg("circle", {
              class: `disc-fill ${box.disc}`,
              cx: rect.x + 14,
              cy: middle,
              r: 4,
            }),
            svg(
              "text",
              {
                class: "name",
                x: rect.x + 25,
                y: box.subline ? middle - 2 : middle + 4,
              },
              box.label,
            ),
          );

          if (box.subline) {
            node.append(
              svg(
                "text",
                { class: "figure", x: rect.x + 25, y: middle + 14 },
                box.subline,
              ),
            );
          }

          if (box.kind === "module" && props?.notes?.marks.has(box.id)) {
            node.append(
              svg("rect", {
                class:
                  props.notes.active === box.id
                    ? "note-mark active"
                    : "note-mark",
                "data-id": box.id,
                x: rect.x + rect.width - 13,
                y: rect.y + 5,
                width: 8,
                height: 8,
                rx: 2,
              }),
            );
          }

          if (box.figures) {
            node.append(
              svg(
                "text",
                {
                  class: "figure",
                  x: rect.x + rect.width - 8,
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

    const card = props?.notes?.card ?? null;
    const anchor =
      card === null
        ? undefined
        : scene.boxes.find((box) => box.id === card.module);

    if (card !== null && anchor !== undefined) {
      const layout = cardLayout(anchor.rect, card.text);
      const node = svg("g", { class: `note-card ${card.tint}` });
      const text = svg("text", { class: "note-card-text" });

      layout.lines.forEach((line, index) => {
        text.append(
          svg(
            "tspan",
            {
              x: layout.card.x + 10,
              y: layout.card.y + 8 + (index + 1) * 18 - 5,
            },
            line,
          ),
        );
      });
      node.append(
        svg("path", { class: "note-leader", d: layout.leader }),
        svg("rect", {
          class: "note-card-body",
          x: layout.card.x,
          y: layout.card.y,
          width: layout.card.width,
          height: layout.card.height,
          rx: 6,
        }),
        text,
      );
      parts.push(node);
    }

    const orientation = props?.orientation ?? null;
    const found = orientation?.card ?? null;
    const target =
      found === null
        ? undefined
        : scene.boxes.find((box) => box.id === found.module);

    if (orientation !== null && found !== null && target !== undefined) {
      const stage = size();
      const visible = {
        x: -viewport.x / viewport.k,
        y: -viewport.y / viewport.k,
        width: stage.width / viewport.k,
        height: stage.height / viewport.k,
      };
      const layout = cardLayout(
        target.rect,
        found.lines.join("\n"),
        {
          width: FINDING_CARD_WIDTH,
          wrap: FINDING_CARD_WRAP,
          soft: true,
        },
        stage.width > 0 ? visible : undefined,
        32,
      );

      if (layout.pan.x !== 0 || layout.pan.y !== 0) {
        viewport = panBy(
          viewport,
          -layout.pan.x * viewport.k,
          -layout.pan.y * viewport.k,
        );
        applyViewport();
      }
      const node = svg("g", {
        class: `finding-card ${orientation.tone}`,
      });
      const text = svg("text", { class: "finding-card-text" });
      const bottom = layout.card.y + layout.card.height;

      layout.lines.forEach((line, index) => {
        text.append(
          svg(
            "tspan",
            {
              x: layout.card.x + 10,
              y: layout.card.y + 8 + (index + 1) * 18 - 5,
            },
            line,
          ),
        );
      });
      node.append(
        svg("path", { class: "finding-leader", d: layout.leader }),
        svg("rect", {
          class: "finding-card-body",
          x: layout.card.x,
          y: layout.card.y,
          width: layout.card.width,
          height: layout.card.height + 32,
          rx: 6,
        }),
        text,
      );

      [
        ["finding-open", "Open in inspector", layout.card.x + 8, 132],
        ["finding-copy", "Copy id", layout.card.x + 148, 64],
      ].forEach(([action, label, x, width]) => {
        const group = svg("g", {
          class: "finding-button",
          "data-action": action as string,
        });

        group.append(
          svg("rect", {
            x: x as number,
            y: bottom + 4,
            width: width as number,
            height: 22,
            rx: 4,
          }),
          svg(
            "text",
            { x: (x as number) + 8, y: bottom + 19 },
            label as string,
          ),
        );
        node.append(group);
      });
      parts.push(node);
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

    const near = props?.neighbourhood ?? null;
    const orientation = props?.orientation ?? null;

    for (const node of world.querySelectorAll<SVGElement>(".frame")) {
      const path = node.dataset.path as string;
      const related =
        near === null ||
        selection?.id === path ||
        [...near].some((id) => id === path || id.startsWith(`${path}/`));

      node.classList.toggle("dim", !related);
    }

    for (const node of world.querySelectorAll<SVGElement>(".box")) {
      node.classList.toggle(
        "dim",
        near !== null && !near.has(node.dataset.id as string),
      );

      const chosen =
        selection !== null &&
        selection.kind !== "edge" &&
        selection.id === node.dataset.id;

      node.classList.toggle("selected", chosen);
      node.classList.toggle(
        "trail",
        props?.trail?.has(node.dataset.id as string) ?? false,
      );
    }

    for (const tone of ["lit-violation", "lit-warning"]) {
      for (const node of world.querySelectorAll<SVGElement>(`.${tone}`)) {
        node.classList.remove(tone);
      }
    }

    if (orientation === null) {
      return;
    }

    const litClass = `lit-${orientation.tone}`;
    const isLit = (id: string) => orientation.lit.has(id);

    for (const group of world.querySelectorAll<SVGElement>(".line-group")) {
      const on = isLit(group.dataset.line as string);

      group.classList.toggle("dim", !on);
      group.classList.toggle(litClass, on);
    }

    for (const node of world.querySelectorAll<SVGElement>(".box")) {
      const on = isLit(node.dataset.id as string);

      node.classList.toggle("dim", !on);
      node.classList.toggle(litClass, on);
    }

    for (const node of world.querySelectorAll<SVGElement>(".frame")) {
      const path = node.dataset.path as string;

      node.classList.toggle(
        "dim",
        ![...orientation.lit].some(
          (id) => id === path || id.startsWith(`${path}/`),
        ),
      );
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
    pointerAnchor =
      event.type === "contextmenu" ? canvasPoint(localPoint(event)) : null;
    choosing = true;
    hover.enter();

    if (target.kind === "edge") {
      actions.select({ kind: "edge", id: target.id });
    } else if (target.kind === "folder") {
      actions.select({ kind: "folder", id: target.id });
    } else {
      actions.select({ kind: "module", id: target.id });
    }

    choosing = false;
  }

  surface.addEventListener("pointerdown", (event) => {
    if (
      event.button !== 0 ||
      targetOf(event) ||
      (event.target as Element | null)?.closest("[data-action]")
    ) {
      return;
    }

    drag = {
      start: { x: event.clientX, y: event.clientY },
      origin: { x: viewport.x, y: viewport.y },
      moved: false,
    };
    surface.setPointerCapture(event.pointerId);
  });

  surface.addEventListener("pointerleave", () => hover.leave());

  surface.addEventListener("pointermove", (event) => {
    const selection = props?.selection;
    const over = targetOf(event);

    if (
      selection &&
      selection.kind !== "edge" &&
      over &&
      over.kind !== "edge" &&
      over.id === selection.id
    ) {
      hover.enter();
    } else {
      hover.leave();
    }

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
    const pressed = (event.target as Element | null)?.closest<SVGElement>(
      "[data-action]",
    );

    if (pressed?.dataset.action === "finding-open") {
      actions.openFinding();

      return;
    }

    if (pressed?.dataset.action === "finding-copy") {
      actions.copyFindingId();

      return;
    }

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

  function perform(action: KeyAction) {
    if (action === "escape") {
      if (legendOpen) {
        legendOpen = false;
        refreshChrome();
      } else {
        actions.select(null);
      }
    } else if (action === "dependencies") {
      actions.openTab("dependencies");
    } else if (action === "contents") {
      actions.openContents();
    } else if (action === "focus") {
      actions.toggleFocus();
    } else if (action === "fold") {
      actions.toggleFold();
    } else if (action === "add-note") {
      actions.addNote();
    } else if (action === "remove-note") {
      actions.removeNote();
    } else if (action === "next-note") {
      actions.walkNotes(1);
    } else if (action === "previous-note") {
      actions.walkNotes(-1);
    } else if (action === "next-finding") {
      actions.walkFindings(1);
    } else if (action === "previous-finding") {
      actions.walkFindings(-1);
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
      props?.notes?.keys,
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
      empty.hidden = next.open > 0;
      notice.textContent = next.notice ?? "";
      notice.hidden = next.notice === null;
      busy.hidden = next.busy !== true;

      const scene = next.scene;
      const has = (scene?.boxes.length ?? 0) > 0;

      if (
        scene !== previous?.scene ||
        next.titles !== previous?.titles ||
        next.notes !== previous?.notes ||
        next.orientation !== previous?.orientation
      ) {
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

      const selected = next.bar
        ? `${next.selection?.kind}:${next.selection?.id}`
        : null;

      if (selected === null || (selected !== shownSelection && !choosing)) {
        hover.reset();
      }

      shownSelection = selected;
      applySelection();
      selectionBar.render(next.bar);
      refreshChrome();
      applyViewport();
    },
  };
}
