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
  | "arrow-left"
  | "eye"
  | "eye-off"
  | "eye-half"
  | "route"
  | "sticky-note"
  | "layers"
  | "scan"
  | "views"
  | "findings"
  | "bell"
  | "triangle-alert"
  | "circle-x"
  | "circle-check"
  | "circle-alert"
  | "circle-dashed"
  | "terminal"
  | "loader"
  | "check"
  | "info"
  | "rotate-ccw"
  | "x";

type Shape = [string, Record<string, string>];

const SVG_NS = "http://www.w3.org/2000/svg";

const SHAPES: Record<IconName, Shape[]> = {
  "circle-check": [
    ["circle", { cx: "12", cy: "12", r: "10" }],
    ["path", { d: "m9 12 2 2 4-4" }],
  ],
  terminal: [
    ["path", { d: "m4 17 6-6-6-6" }],
    ["path", { d: "M12 19h8" }],
  ],
  "circle-alert": [
    ["circle", { cx: "12", cy: "12", r: "10" }],
    ["path", { d: "M12 8v4M12 16h.01" }],
  ],
  "circle-dashed": [
    [
      "path",
      {
        d: "M10.1 2.182a10 10 0 0 1 3.8 0M13.9 21.818a10 10 0 0 1-3.8 0M17.609 3.721a10 10 0 0 1 2.69 2.7M2.182 13.9a10 10 0 0 1 0-3.8M20.279 17.609a10 10 0 0 1-2.7 2.69M21.818 10.1a10 10 0 0 1 0 3.8M3.721 6.391a10 10 0 0 1 2.7-2.69M6.391 20.279a10 10 0 0 1-2.69-2.7",
      },
    ],
  ],
  loader: [["path", { d: "M21 12a9 9 0 1 1-6.219-8.56" }]],
  "chevron-right": [["path", { d: "M9 6l6 6-6 6" }]],
  "chevron-left": [["path", { d: "M15 6l-6 6 6 6" }]],
  "rotate-ccw": [
    ["path", { d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" }],
    ["path", { d: "M3 3v5h5" }],
  ],
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
  "arrow-left": [
    ["path", { d: "M19 12H5" }],
    ["path", { d: "m12 19-7-7 7-7" }],
  ],
  eye: [
    [
      "path",
      {
        d: "M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0",
      },
    ],
    ["circle", { cx: "12", cy: "12", r: "3" }],
  ],
  "eye-half": [
    [
      "path",
      {
        d: "M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0",
      },
    ],
    ["path", { d: "M9 12h6" }],
  ],
  "eye-off": [
    [
      "path",
      {
        d: "M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68",
      },
    ],
    [
      "path",
      {
        d: "M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61",
      },
    ],
    ["path", { d: "m2 2 20 20" }],
  ],
  route: [
    ["circle", { cx: "6", cy: "19", r: "3" }],
    ["path", { d: "M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" }],
    ["circle", { cx: "18", cy: "5", r: "3" }],
  ],
  layers: [
    [
      "path",
      {
        d: "M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z",
      },
    ],
    [
      "path",
      {
        d: "M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12",
      },
    ],
    [
      "path",
      {
        d: "M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17",
      },
    ],
  ],
  "sticky-note": [
    [
      "path",
      { d: "M16 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V9Z" },
    ],
    ["path", { d: "M15 3v4a2 2 0 0 0 2 2h4" }],
  ],
  scan: [["path", { d: "M3 12h4l3-8 4 16 3-8h4" }]],
  views: [
    ["path", { d: "M12 3l9 5-9 5-9-5z" }],
    ["path", { d: "M3 13l9 5 9-5" }],
  ],
  findings: [
    ["circle", { cx: "12", cy: "12", r: "9" }],
    ["path", { d: "M12 7v6M12 16.5v.5" }],
  ],
  x: [["path", { d: "M18 6L6 18M6 6l12 12" }]],
  bell: [
    ["path", { d: "M10.268 21a2 2 0 0 0 3.464 0" }],
    [
      "path",
      {
        d: "M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326",
      },
    ],
  ],
  "triangle-alert": [
    [
      "path",
      {
        d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",
      },
    ],
    ["path", { d: "M12 9v4" }],
    ["path", { d: "M12 17h.01" }],
  ],
  "circle-x": [
    ["circle", { cx: "12", cy: "12", r: "10" }],
    ["path", { d: "m15 9-6 6" }],
    ["path", { d: "m9 9 6 6" }],
  ],
  check: [["path", { d: "M20 6 9 17l-5-5" }]],
  info: [
    ["circle", { cx: "12", cy: "12", r: "10" }],
    ["path", { d: "M12 16v-4" }],
    ["path", { d: "M12 8h.01" }],
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
