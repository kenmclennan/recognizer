import { el } from "./dom";

export type IconName =
  | "chevron-right"
  | "chevron-left"
  | "save"
  | "link"
  | "chevron-down"
  | "panel"
  | "panel-right"
  | "arrow-down"
  | "arrow-up"
  | "dependencies"
  | "focus"
  | "fold"
  | "unfold"
  | "list"
  | "folder"
  | "folder-open"
  | "take-off"
  | "external-link"
  | "arrow-right"
  | "route"
  | "x";

type Shape = [string, Record<string, string>];

const SVG_NS = "http://www.w3.org/2000/svg";

const SHAPES: Record<IconName, Shape[]> = {
  "chevron-right": [["path", { d: "M9 6l6 6-6 6" }]],
  "chevron-left": [["path", { d: "M15 6l-6 6 6 6" }]],
  "chevron-down": [["path", { d: "M6 9l6 6 6-6" }]],
  save: [
    [
      "path",
      {
        d: "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z",
      },
    ],
    ["path", { d: "M17 21v-8H7v8M7 3v5h8" }],
  ],
  link: [
    [
      "path",
      { d: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" },
    ],
    [
      "path",
      { d: "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" },
    ],
  ],
  panel: [
    ["rect", { x: "3", y: "4", width: "18", height: "16", rx: "2" }],
    ["path", { d: "M9 4v16" }],
  ],
  "panel-right": [
    ["rect", { x: "3", y: "4", width: "18", height: "16", rx: "2" }],
    ["path", { d: "M15 4v16" }],
  ],
  "arrow-down": [["path", { d: "M12 5v14M5 12l7 7 7-7" }]],
  "arrow-up": [["path", { d: "M12 19V5M5 12l7-7 7 7" }]],
  dependencies: [
    ["circle", { cx: "12", cy: "18", r: "3" }],
    ["circle", { cx: "6", cy: "6", r: "3" }],
    ["circle", { cx: "18", cy: "6", r: "3" }],
    ["path", { d: "M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9" }],
    ["path", { d: "M12 12v3" }],
  ],
  focus: [
    ["circle", { cx: "12", cy: "12", r: "3" }],
    [
      "path",
      {
        d: "M3 9V5a2 2 0 0 1 2-2h4M15 3h4a2 2 0 0 1 2 2v4M21 15v4a2 2 0 0 1-2 2h-4M9 21H5a2 2 0 0 1-2-2v-4",
      },
    ],
  ],
  fold: [["path", { d: "M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" }]],
  unfold: [["path", { d: "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" }]],
  list: [["path", { d: "M4 6h16M4 12h16M4 18h10" }]],
  folder: [
    [
      "path",
      {
        d: "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",
      },
    ],
  ],
  "folder-open": [
    [
      "path",
      {
        d: "m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2",
      },
    ],
  ],
  "take-off": [
    ["rect", { x: "3", y: "3", width: "18", height: "18", rx: "2" }],
    ["path", { d: "M8 12h8" }],
  ],
  "external-link": [
    ["path", { d: "M15 3h6v6M10 14L21 3" }],
    ["path", { d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" }],
  ],
  "arrow-right": [["path", { d: "M5 12h14M13 6l6 6-6 6" }]],
  route: [
    ["circle", { cx: "6", cy: "19", r: "3" }],
    ["path", { d: "M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" }],
    ["circle", { cx: "18", cy: "5", r: "3" }],
  ],
  x: [["path", { d: "M18 6L6 18M6 6l12 12" }]],
};

export function icon(name: IconName, className = ""): SVGSVGElement {
  const node = document.createElementNS(SVG_NS, "svg");

  node.setAttribute("class", `i ${className}`.trim());
  node.setAttribute("viewBox", "0 0 24 24");
  node.setAttribute("aria-hidden", "true");

  for (const [tag, attributes] of SHAPES[name]) {
    const shape = document.createElementNS(SVG_NS, tag);

    for (const [key, value] of Object.entries(attributes)) {
      shape.setAttribute(key, value);
    }

    node.append(shape);
  }

  return node;
}

export function iconButton(
  name: IconName,
  label: string,
  className: string,
  onClick: () => void,
): HTMLButtonElement {
  const node = el("button", `ib ${className}`.trim());

  node.type = "button";
  node.setAttribute("aria-label", label);
  node.title = label;
  node.append(icon(name));
  node.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });

  return node;
}
