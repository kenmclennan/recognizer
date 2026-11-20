import { el } from "./dom";

const SVG_NS = "http://www.w3.org/2000/svg";

export function spinner(label: string): HTMLElement {
  const holder = el("div", "spinner");
  const node = document.createElementNS(SVG_NS, "svg");

  node.setAttribute("class", "spinner-icon");
  node.setAttribute("viewBox", "0 0 24 24");
  node.setAttribute("aria-hidden", "true");

  const track = document.createElementNS(SVG_NS, "circle");

  track.setAttribute("class", "spinner-track");
  track.setAttribute("cx", "12");
  track.setAttribute("cy", "12");
  track.setAttribute("r", "9");

  const arc = document.createElementNS(SVG_NS, "path");

  arc.setAttribute("class", "spinner-arc");
  arc.setAttribute("d", "M12 3a9 9 0 0 1 9 9");

  node.append(track, arc);
  holder.append(node);
  holder.setAttribute("role", "status");
  holder.setAttribute("aria-label", label);

  return holder;
}
