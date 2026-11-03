import type { Mark } from "recognizer";
import { createBarHover, type Scheduler, timerScheduler } from "./bar-hover";
import type { TooltipLine } from "./box-tooltip";
import {
  isEditable,
  type KeyAction,
  keyAction,
  type NoteKeyContext,
} from "./canvas-keys";
import {
  NOTE_MARK_INSET,
  NOTE_MARK_SIZE,
  type Point,
  type Rect,
} from "./canvas-layout";
import type { Scene } from "./canvas-scene";
import type { Selection } from "./canvas-state";
import { button, el } from "./dom";
import { icon } from "./icons";
import type { InspectorTab } from "./inspector-model";
import { buildLegendView } from "./legend-view";
import {
  BAR_ROW,
  BAR_TRACK_HEIGHT,
  barRect,
  barTitle,
  fraction,
  tone as metricTone,
  valueLabel,
} from "./metric-bars";
import { buildMetricsView, type CanvasMetrics } from "./metrics-view";
import {
  buildNoteBubbleView,
  type NoteBubble,
  type NoteBubbleView,
} from "./note-bubble-view";
import { bubblePlace, bubbleSize } from "./note-focus";
import type { RemovedBox } from "./removed-boxes";
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
import { easeViewport, walkthroughViewport } from "./walkthrough-pan";
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
  tooltip?: (id: string) => TooltipLine[] | null;
  orientation?: CanvasOrientation | null;
  metrics?: CanvasMetrics | null;
  changes?: ChangeOverlay | null;
};

export type ChangeOverlay = {
  marks: ReadonlyMap<string, Mark>;
  removed: RemovedBox[];
};

export type CanvasOrientation = {
  lit: ReadonlySet<string>;
  tone: "violation" | "warning";
};

export type CanvasNotes = {
  marks: ReadonlySet<string>;
  active: string | null;
  bubbles: NoteBubble[];
  showAll: boolean;
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
  toggleMetric: (key: string) => void;
  measure: (text: string) => number;
  openTab: (tab: InspectorTab) => void;
  openContents: () => void;
  openInEditor: () => void;
  addNote: () => void;
  toggleNotes: () => void;
  openNote: (path: string) => void;
  editNote: (path: string) => void;
  cancelNote: (path: string) => void;
  saveNote: (path: string, text: string) => void;
  removeNoteAt: (path: string) => void;
  removeNote: () => void;
  walkNotes: (delta: 1 | -1) => void;
  stepNote: (path: string) => void;
  walkFindings: (delta: 1 | -1) => void;
  pickName: (id: string) => void;
};

export type CanvasView = {
  element: HTMLElement;
  render: (props: CanvasProps) => void;
  centerOn: (id: string) => void;
  walkTo: (path: string, options: { animate: boolean }) => void;
};

type BubbleScreen = {
  path: string;
  x: number;
  y: number;
  side: "right" | "left";
};

const PAN_MS = 200;
const PAN_FRAME_MS = 16;

export const PINCH_SPEED = 0.01;
export const MOUSE_ZOOM_STEP = 1.15;
export const BUTTON_ZOOM_STEP = 1.25;
export const DRAG_THRESHOLD = 4;

const SVG = "http://www.w3.org/2000/svg";
const TIP_DELAY = 400;

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

function drawRemoved(removed: RemovedBox): SVGElement {
  const { rect } = removed;
  const middle = rect.y + rect.height / 2;
  const node = svg("g", {
    class: "box module mark-removed removed-box",
    "data-kind": "module",
    "data-id": removed.id,
    "data-removed": removed.id,
  });

  node.append(
    svg("rect", {
      class: "box-body",
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      rx: 7,
    }),
    svg("text", { class: "name", x: rect.x + 12, y: middle + 4 }, removed.name),
  );

  return node;
}

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
  const noteLayer = el("div", "note-layer");
  const bubbleViews = new Map<string, NoteBubbleView>();
  const tip = el("div", "box-tip");
  let tipTimer: ReturnType<typeof setTimeout> | null = null;
  let tipFor: string | null = null;

  busy.classList.add("canvas-busy");
  busy.hidden = true;
  const legend = buildLegendView((show) => actions.setShowInferred(show));
  const metricsView = buildMetricsView((key) => actions.toggleMetric(key));
  const selectionBar = buildSelectionBar({
    openTab: (tab) => actions.openTab(tab),
    toggleFocus: () => actions.toggleFocus(),
    toggleFold: () => actions.toggleFold(),
    openContents: () => actions.openContents(),
    openInEditor: () => actions.openInEditor(),
    takeOff: () => actions.takeOff(),
    openNote: () => actions.addNote(),
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
  let metricsOpen = false;
  let pointerAnchor: Point | null = null;
  let pendingCenter: string | null = null;
  let bubbleScreen: BubbleScreen | null = null;
  let priorScreen: BubbleScreen | null = null;
  let pan: ReturnType<typeof setTimeout> | null = null;
  let pendingWalk: { path: string; animate: boolean } | null = null;
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
    metricsOpen = false;
    refreshChrome();
  });
  const metricsButton = button("Metrics", "control metrics-toggle", () => {
    metricsOpen = !metricsOpen;
    legendOpen = false;
    refreshChrome();
  });
  const notesButton = button("Notes", "control notes-toggle", () =>
    actions.toggleNotes(),
  );

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
  noteLayer.hidden = true;
  tip.hidden = true;
  stage.append(
    surface,
    noteLayer,
    tip,
    empty,
    notice,
    busy,
    selectionBar.element,
  );
  controls.append(
    zoomOut,
    level,
    zoomIn,
    fitButton,
    clearButton,
    metricsButton,
    notesButton,
    legendButton,
  );

  element.append(stage, controls, legend.element, metricsView.element);

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
    noteLayer.style.transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.k})`;
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
    legend.render(
      legendOpen,
      props?.showInferred ?? true,
      props?.changes != null,
    );
    legendButton.classList.toggle("on", legendOpen);
    metricsView.render(metricsOpen, props?.metrics ?? null);
    metricsButton.classList.toggle("on", metricsOpen);
    notesButton.classList.toggle("on", props?.notes?.showAll === true);
    notesButton.setAttribute(
      "aria-pressed",
      String(props?.notes?.showAll === true),
    );
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

          if (props?.notes?.marks.has(`${frame.path}/`)) {
            const at = frameMarkRect(rect);

            node.append(noteMark(`${frame.path}/`, at.x, at.y));
          }

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

          if (line.dash) {
            stroke.setAttribute("stroke-dasharray", line.dash);
          }

          const arrow = scene.arrows.find((a) => a.lineId === line.id);
          const title = props?.titles.get(line.id);

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
            class: `box ${box.kind}${
              props?.changes?.marks.has(box.id)
                ? ` mark-${props.changes.marks.get(box.id)}`
                : ""
            }`,
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

          node.append(...metricBars(box));

          const boxPath = box.kind === "folder" ? `${box.id}/` : box.id;

          const marked = props?.notes?.marks.has(boxPath) === true;

          if (marked) {
            const at = markRect(box);

            node.append(noteMark(boxPath, at.x, at.y));
          }

          group.append(node);
        }
      }

      parts.push(group);
    }

    for (const removed of props?.changes?.removed ?? []) {
      parts.push(drawRemoved(removed));
    }

    world.replaceChildren(...parts);
  }

  function metricBars(box: Scene["boxes"][number]): SVGElement[] {
    const ticked = props?.metrics?.ticked ?? [];
    const base = box.rect.height - ticked.length * BAR_ROW;

    return ticked.map((metric, index) => {
      const found =
        box.kind === "folder"
          ? null
          : (props?.metrics?.valueOf(metric, box.id) ?? null);
      const track = barRect(box.rect, base, index);
      const group = svg("g", {
        class: "metric-bar",
        "data-metric": metric.key,
      });
      const body = svg("rect", {
        class: found === null ? "metric-track unknown" : "metric-track",
        x: track.x,
        y: track.y,
        width: track.width,
        height: BAR_TRACK_HEIGHT,
        rx: 3,
      });
      const label = svg(
        "text",
        {
          class: "metric-value",
          x: box.rect.x + box.rect.width - 10,
          y: track.y + BAR_TRACK_HEIGHT,
          "text-anchor": "end",
        },
        found === null ? "-" : valueLabel(metric, found.value),
      );

      group.append(svg("title", {}, barTitle(metric, found)), body);

      if (found !== null) {
        group.append(
          svg("rect", {
            class: `metric-fill ${metricTone(metric, found.value)}`,
            x: track.x,
            y: track.y,
            width: track.width * fraction(metric, found.value),
            height: BAR_TRACK_HEIGHT,
            rx: 3,
          }),
        );
      }

      group.append(label);

      return group;
    });
  }

  function noteMark(path: string, x: number, y: number): SVGElement {
    const mark = svg("g", { class: "note-mark" });
    const glyph = icon("sticky-note");

    glyph.setAttribute("x", String(x));
    glyph.setAttribute("y", String(y));
    glyph.setAttribute("width", String(NOTE_MARK_SIZE));
    glyph.setAttribute("height", String(NOTE_MARK_SIZE));
    mark.dataset.noteMark = path;
    mark.append(glyph);

    if (props?.notes?.active === path) {
      mark.classList.add("active");
    }

    return mark;
  }

  function bubbleAnchor(
    scene: Scene,
    path: string,
  ): { target: Rect; mark: Rect } | null {
    if (path.endsWith("/")) {
      const bare = path.slice(0, -1);
      const frame = scene.frames.find((one) => one.path === bare);

      if (frame !== undefined) {
        const mark = frameMarkRect(frame.rect);

        return {
          target: { ...mark, y: frame.rect.y, height: mark.height + 12 },
          mark,
        };
      }
    }

    const id = path.endsWith("/") ? path.slice(0, -1) : path;
    const box = scene.boxes.find(
      (one) => one.id === id && (one.kind === "folder") === path.endsWith("/"),
    );

    return box === undefined ? null : { target: box.rect, mark: markRect(box) };
  }

  function frameMarkRect(rect: Rect): Rect {
    return {
      x: rect.x + rect.width - NOTE_MARK_SIZE - NOTE_MARK_INSET,
      y: rect.y + NOTE_MARK_INSET,
      width: NOTE_MARK_SIZE,
      height: NOTE_MARK_SIZE,
    };
  }

  function markRect(box: Scene["boxes"][number]): Rect {
    const mark = frameMarkRect(box.rect);

    return { ...mark, y: box.rect.y + (box.rect.height - mark.height) / 2 };
  }

  function bubbleViewFor(path: string): NoteBubbleView {
    let one = bubbleViews.get(path);

    if (one === undefined) {
      one = buildNoteBubbleView({
        focus: (target) => actions.openNote(target),
        edit: (target) => actions.editNote(target),
        cancel: (target) => actions.cancelNote(target),
        save: (target, text) => actions.saveNote(target, text),
        remove: (target) => actions.removeNoteAt(target),
        previous: (target) => actions.stepNote(target),
        next: (target) => actions.stepNote(target),
      });
      bubbleViews.set(path, one);
    }

    return one;
  }

  function drawBubbles() {
    const bubbles = props?.notes?.bubbles ?? [];
    const scene = props?.scene ?? null;
    const drawn = new Set<string>();

    for (const bubble of bubbles) {
      const anchor = scene === null ? null : bubbleAnchor(scene, bubble.path);

      if (anchor !== null) {
        drawBubble(bubble, anchor);
        drawn.add(bubble.path);
      }
    }

    for (const [path, one] of bubbleViews) {
      if (!drawn.has(path)) {
        one.close();
        bubbleViews.delete(path);
      }
    }

    noteLayer.hidden = drawn.size === 0;
  }

  function drawBubble(
    bubble: NoteBubble,
    anchor: { target: Rect; mark: Rect },
  ) {
    const noteBubble = bubbleViewFor(bubble.path);

    if (noteBubble.element.parentElement !== noteLayer) {
      noteLayer.append(noteBubble.element);
    }

    const view = {
      x: -viewport.x / viewport.k,
      y: -viewport.y / viewport.k,
      width: surface.clientWidth / viewport.k,
      height: surface.clientHeight / viewport.k,
    };
    const useView = view.width > 0 && view.height > 0 ? view : undefined;
    const size = bubbleSize(bubble.text ?? "", bubble.editing);

    noteBubble.render(
      bubble,
      bubblePlace(anchor.target, anchor.mark, size, useView),
    );

    const measured = noteBubble.height();

    if (measured > 0 && Math.abs(measured - size.height) > 0.5) {
      noteBubble.render(
        bubble,
        bubblePlace(
          anchor.target,
          anchor.mark,
          { width: size.width, height: measured },
          useView,
        ),
      );
    }

    noteBubble.element.style.zIndex = bubble.focused ? "2" : "1";

    if (bubble.focused) {
      rememberBubble(bubble.path, noteBubble.element);
    }
  }

  function rememberBubble(path: string, element: HTMLElement) {
    const left = Number.parseFloat(element.style.left);
    const top = Number.parseFloat(element.style.top);

    if (Number.isNaN(left) || Number.isNaN(top)) {
      return;
    }

    const next: BubbleScreen = {
      path,
      x: left,
      y: top,
      side: element.classList.contains("left") ? "left" : "right",
    };

    if (bubbleScreen !== null && bubbleScreen.path !== path) {
      priorScreen = bubbleScreen;
    }

    bubbleScreen = next;
  }

  function hideTip() {
    if (tipTimer !== null) {
      clearTimeout(tipTimer);
      tipTimer = null;
    }

    tipFor = null;
    tip.hidden = true;
  }

  function showTip(id: string) {
    const lines = props?.tooltip?.(id) ?? null;
    const rect = rectOf(id);

    if (lines === null || !rect) {
      tip.hidden = true;

      return;
    }

    tip.replaceChildren(
      ...lines.map((line) => el("div", `tip-line ${line.tone}`, line.text)),
    );
    tip.style.left = `${viewport.x + rect.x * viewport.k}px`;
    tip.style.top = `${viewport.y + (rect.y + rect.height) * viewport.k + 6}px`;
    tip.hidden = false;
  }

  function hoverTip(over: { kind: string; id: string } | null) {
    const id = over !== null && over.kind === "module" ? over.id : null;

    if (id === tipFor) {
      return;
    }

    hideTip();

    if (id === null) {
      return;
    }

    tipFor = id;
    tipTimer = setTimeout(() => {
      tipTimer = null;
      showTip(id);
    }, TIP_DELAY);
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
    cancelPan();

    if (
      event.button !== 0 ||
      targetOf(event) ||
      (event.target as Element | null)?.closest(
        "[data-action], [data-note-mark]",
      )
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

  surface.addEventListener("pointerleave", () => {
    hover.leave();
    hoverTip(null);
  });

  surface.addEventListener("pointermove", (event) => {
    const selection = props?.selection;
    const over = targetOf(event);

    hoverTip(over);

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
      hideTip();
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
    const mark = (event.target as Element | null)?.closest<SVGElement>(
      "[data-note-mark]",
    );

    if (mark) {
      actions.openNote(mark.dataset.noteMark as string);

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
      cancelPan();

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
  stage.addEventListener("pointerdown", () => {
    if (metricsOpen) {
      metricsOpen = false;
      refreshChrome();
    }
  });
  stage.addEventListener("gestureend", (event) => {
    event.preventDefault();
    gesture = false;
  });

  function perform(action: KeyAction) {
    if (action === "escape") {
      if (legendOpen || metricsOpen) {
        legendOpen = false;
        metricsOpen = false;
        refreshChrome();
      } else {
        actions.select(null);
      }
    } else if (action === "dependencies") {
      actions.openTab("dependencies");
    } else if (action === "findings") {
      if (props?.bar?.findings) {
        actions.openTab("findings");
      }
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
        inInspector:
          (event.target as Element | null)?.closest?.(".inspector") != null,
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

  function cancelPan() {
    if (pan !== null) {
      clearTimeout(pan);
      pan = null;
    }
  }

  function walkNow(path: string, animate: boolean): boolean {
    const scene = props?.scene ?? null;
    const anchor = scene === null ? null : bubbleAnchor(scene, path);

    if (anchor === null) {
      return false;
    }

    const from =
      bubbleScreen !== null && bubbleScreen.path !== path
        ? bubbleScreen
        : (priorScreen ?? bubbleScreen);

    priorScreen = null;

    if (from === null) {
      return centerNow(path.endsWith("/") ? path.slice(0, -1) : path);
    }

    const to = walkthroughViewport({
      box: anchor.target,
      side: from.side,
      bubbleWidth: bubbleSize("", false).width,
      anchor: {
        x: viewport.x + from.x * viewport.k,
        y: viewport.y + from.y * viewport.k,
      },
      k: viewport.k,
    });

    cancelPan();

    const reduced =
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!animate || reduced) {
      viewport = to;
      applyViewport();
      drawBubbles();

      return true;
    }

    const start = viewport;
    const began = performance.now();
    const frame = () => {
      const t = (performance.now() - began) / PAN_MS;

      viewport = easeViewport(start, to, t);
      applyViewport();
      drawBubbles();
      pan = t >= 1 ? null : setTimeout(frame, PAN_FRAME_MS);
    };

    pan = setTimeout(frame, PAN_FRAME_MS);

    return true;
  }

  return {
    element,
    walkTo(path, options) {
      if (!walkNow(path, options.animate)) {
        pendingWalk = { path, animate: options.animate };
      }
    },
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
        next.orientation !== previous?.orientation ||
        next.changes !== previous?.changes
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

      if (
        pendingWalk !== null &&
        walkNow(pendingWalk.path, pendingWalk.animate)
      ) {
        pendingWalk = null;
      }

      if (next.selection === null) {
        pointerAnchor = null;

        if (!next.notes?.bubbles.some((bubble) => bubble.focused)) {
          bubbleScreen = null;
          priorScreen = null;
        }
      }

      const selected = next.bar
        ? `${next.selection?.kind}:${next.selection?.id}`
        : null;

      if (selected === null || (selected !== shownSelection && !choosing)) {
        hover.reset();
      }

      shownSelection = selected;
      applySelection();
      drawBubbles();
      if (tipFor !== null && !tip.hidden) {
        showTip(tipFor);
      }
      selectionBar.render(next.bar);
      refreshChrome();
      applyViewport();
    },
  };
}
