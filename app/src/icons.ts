import { el } from "./dom";

export type IconName =
  | "chevron-right"
  | "chevron-down"
  | "plus"
  | "eye"
  | "target"
  | "panel";

type Shape = [string, Record<string, string>];

const SVG_NS = "http://www.w3.org/2000/svg";

const SHAPES: Record<IconName, Shape[]> = {
  "chevron-right": [["path", { d: "M9 6l6 6-6 6" }]],
  "chevron-down": [["path", { d: "M6 9l6 6 6-6" }]],
  plus: [["path", { d: "M12 5v14M5 12h14" }]],
  eye: [
    ["path", { d: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" }],
    ["circle", { cx: "12", cy: "12", r: "3" }],
  ],
  target: [
    ["circle", { cx: "12", cy: "12", r: "7" }],
    ["circle", { cx: "12", cy: "12", r: "2" }],
    ["path", { d: "M12 2v3M12 19v3M2 12h3M19 12h3" }],
  ],
  panel: [
    ["rect", { x: "3", y: "4", width: "18", height: "16", rx: "2" }],
    ["path", { d: "M9 4v16" }],
  ],
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
