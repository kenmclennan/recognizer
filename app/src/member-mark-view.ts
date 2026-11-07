import { el } from "./dom";
import type { MemberIcon, MemberMark, MemberMarkWord } from "./member-mark";

const SVG = "http://www.w3.org/2000/svg";

const PATHS: Record<MemberIcon, string[]> = {
  plus: ["M5 12h14", "M12 5v14"],
  delta: ["M12 5 4 19h16z"],
  minus: ["M5 12h14"],
};

export function iconNode(icon: MemberIcon): SVGElement {
  const svg = document.createElementNS(SVG, "svg");

  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2.25");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");

  for (const d of PATHS[icon]) {
    const path = document.createElementNS(SVG, "path");

    path.setAttribute("d", d);
    svg.append(path);
  }

  return svg;
}

export function bandNode(mark: MemberMark): HTMLElement {
  const band = el("span", `member-band ${mark.icon}`);

  band.title = mark.word;
  band.append(iconNode(mark.icon));

  return band;
}

export function legendMemberRow(
  icon: MemberIcon,
  word: MemberMarkWord,
  label: string,
): HTMLElement {
  const row = el("div", "legend-row member-legend-row");
  const swatch = el("span", `member-swatch ${icon}`);

  swatch.append(iconNode(icon));
  row.append(swatch, el("span", "", label));
  row.dataset.word = word;

  return row;
}
