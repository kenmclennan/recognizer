import { el } from "./dom";

export type IconName =
  | "chevron-right"
  | "chevron-down"
  | "panel"
  | "panel-right"
  | "arrow-down"
  | "arrow-up"
  | "focus"
  | "fold"
  | "unfold"
  | "list"
  | "x";

type Shape = [string, Record<string, string>];

const SVG_NS = "http://www.w3.org/2000/svg";

const SHAPES: Record<IconName, Shape[]> = {
  "chevron-right": [["path", { d: "M9 6l6 6-6 6" }]],
  "chevron-down": [["path", { d: "M6 9l6 6 6-6" }]],
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
