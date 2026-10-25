import type { EdgeStyle } from "./canvas-graph";
import { DASH } from "./canvas-scene";
import { el } from "./dom";
import type { Disc } from "./health";

export type LegendView = {
  element: HTMLElement;
  render: (open: boolean, showInferred: boolean) => void;
};

const SVG = "http://www.w3.org/2000/svg";

const EDGES: { style: EdgeStyle; label: string }[] = [
  { style: "plain", label: "dependency" },
  { style: "private", label: "import of a private name" },
  { style: "inferred", label: "inferred dependency" },
  { style: "hollow", label: "implements or inherits" },
];

const DISCS: { disc: Disc; label: string }[] = [
  { disc: "green", label: "fine" },
  { disc: "amber", label: "warning" },
  { disc: "red", label: "violation" },
  { disc: "grey", label: "not measured" },
];

function swatch(style: EdgeStyle): SVGElement {
  const svg = document.createElementNS(SVG, "svg");
  const line = document.createElementNS(SVG, "line");
  const head = document.createElementNS(SVG, "polygon");

  svg.setAttribute("width", "40");
  svg.setAttribute("height", "12");
  line.setAttribute("x1", "0");
  line.setAttribute("x2", "30");
  line.setAttribute("y1", "6");
  line.setAttribute("y2", "6");
  line.setAttribute("class", `edge ${style}`);

  const dash = DASH[style];

  if (dash) {
    line.setAttribute("stroke-dasharray", dash);
  }

  head.setAttribute("points", "38,6 30,2 30,10");
  head.setAttribute("class", style === "hollow" ? "arrow hollow" : "arrow");
  svg.append(line, head);

  return svg;
}

export function buildLegendView(
  setShowInferred: (show: boolean) => void,
): LegendView {
  const element = el("div", "canvas-legend");
  const checkbox = el("input");
  const label = el("label", "switch");

  element.hidden = true;
  element.addEventListener("pointerdown", (event) => event.stopPropagation());
  element.addEventListener("click", (event) => event.stopPropagation());
  checkbox.type = "checkbox";
  checkbox.addEventListener("change", () => setShowInferred(checkbox.checked));
  label.append(checkbox, el("span", "", "Show inferred dependencies"));

  const rows: HTMLElement[] = [el("h4", "", "Edges")];

  for (const entry of EDGES) {
    const row = el("div", "legend-row");

    row.append(swatch(entry.style), el("span", "", entry.label));
    rows.push(row);
  }

  rows.push(el("h4", "", "Discs"));

  for (const entry of DISCS) {
    const row = el("div", "legend-row");

    row.append(
      el("span", `disc disc-${entry.disc}`),
      el("span", "", entry.label),
    );
    rows.push(row);
  }

  rows.push(
    el("h4", "", "Figures"),
    el(
      "p",
      "",
      "Frame: open files of the files it holds, subfolders included.",
    ),
    el(
      "p",
      "",
      "Box: dependencies (up) and dependents (down) that are not on the canvas.",
    ),
    el("p", "", "Folded box: open files of its files."),
    label,
  );
  element.append(...rows);

  return {
    element,
    render(open, showInferred) {
      element.hidden = !open;
      checkbox.checked = showInferred;
    },
  };
}
