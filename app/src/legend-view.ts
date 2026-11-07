import type { EdgeStyle } from "./canvas-graph";
import { DASH } from "./canvas-scene";
import { el } from "./dom";
import type { Disc } from "./health";
import { iconOf, type MemberMarkWord } from "./member-mark";
import { legendMemberRow } from "./member-mark-view";
import { buildCheckbox, setCheckState } from "./row-view";

export type LegendView = {
  element: HTMLElement;
  render: (open: boolean, showInferred: boolean, mode: LegendMode) => void;
};

export type LegendMode = "none" | "change" | "plan";

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

const CHANGE_MARKS: { mark: string; label: string }[] = [
  { mark: "added", label: "added" },
  { mark: "modified", label: "modified" },
  { mark: "removed", label: "removed" },
];

const PLAN_ROWS: { kind: string; label: string }[] = [
  { kind: "new", label: "New" },
  { kind: "changes", label: "Changes" },
  { kind: "moves", label: "Moves" },
  { kind: "moves-and-changes", label: "Moves + changes" },
  { kind: "removed", label: "Removed" },
  { kind: "moved-from", label: "Where a moved module was" },
];

const PLAN_MEMBER_ROWS: { word: MemberMarkWord; label: string }[] = [
  { word: "new", label: "New" },
  { word: "changes", label: "Changes" },
  { word: "removed", label: "Removed" },
];

const CHANGE_MEMBER_ROWS: { word: MemberMarkWord; label: string }[] = [
  { word: "added", label: "Added" },
  { word: "modified", label: "Modified" },
  { word: "removed", label: "Removed" },
];

function memberRows(
  entries: { word: MemberMarkWord; label: string }[],
): HTMLElement[] {
  return [
    el("h4", "", "Members, in the inspector"),
    ...entries.map((entry) =>
      legendMemberRow(iconOf(entry.word), entry.word, entry.label),
    ),
  ];
}

export function buildLegendView(
  setShowInferred: (show: boolean) => void,
): LegendView {
  const element = el("div", "canvas-legend");
  const label = el("div", "switch");
  let shown = false;
  const checkbox = buildCheckbox(
    "Show inferred dependencies",
    "unchecked",
    () => setShowInferred(!shown),
  );

  element.hidden = true;
  element.addEventListener("pointerdown", (event) => event.stopPropagation());
  element.addEventListener("click", (event) => event.stopPropagation());
  label.addEventListener("click", () => setShowInferred(!shown));
  label.append(checkbox, el("span", "", "Show inferred dependencies"));

  const rows: HTMLElement[] = [el("h4", "", "Edges")];

  for (const entry of EDGES) {
    const row = el("div", "legend-row");

    row.append(swatch(entry.style), el("span", "", entry.label));
    rows.push(row);
  }

  const changeRows: HTMLElement[] = [el("h4", "", "Changes")];

  for (const entry of CHANGE_MARKS) {
    const row = el("div", `legend-row change-legend-row ${entry.mark}`);

    row.append(
      el("span", `change-swatch ${entry.mark}`),
      el("span", "", entry.label),
    );
    changeRows.push(row);
  }

  changeRows.push(...memberRows(CHANGE_MEMBER_ROWS));

  for (const row of changeRows) {
    row.hidden = true;
  }

  const planRows: HTMLElement[] = [el("h4", "", "Plan")];

  for (const entry of PLAN_ROWS) {
    const row = el("div", `legend-row plan-legend-row ${entry.kind}`);

    row.append(
      el("span", `plan-swatch ${entry.kind}`),
      el("span", "", entry.label),
    );
    planRows.push(row);
  }

  planRows.push(...memberRows(PLAN_MEMBER_ROWS));

  for (const row of planRows) {
    row.hidden = true;
  }

  rows.push(...changeRows, ...planRows);
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
    el("p", "", "Folded box: open files of its files."),
    label,
  );
  element.append(...rows);

  return {
    element,
    render(open, showInferred, mode) {
      element.hidden = !open;

      for (const row of changeRows) {
        row.hidden = mode !== "change";
      }

      for (const row of planRows) {
        row.hidden = mode !== "plan";
      }

      shown = showInferred;
      setCheckState(checkbox, showInferred ? "checked" : "unchecked");
    },
  };
}
