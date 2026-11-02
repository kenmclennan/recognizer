import { el } from "./dom";
import type { BadgeTone } from "./findings-order";
import { iconButton } from "./icons";

export type LeftPanel =
  | "files"
  | "views"
  | "notes"
  | "scan"
  | "findings"
  | null;

export type RailActions = {
  toggleFiles: () => void;
  toggleViews: () => void;
  toggleNotes: () => void;
  toggleScan: () => void;
  toggleFindings: () => void;
};

export type RailState = {
  panel: LeftPanel;
  notes: number;
  scanFailed: boolean;
  findings: { count: number; tone: BadgeTone };
};

export type RailView = {
  element: HTMLElement;
  render: (state: RailState) => void;
};

export function buildRailView(actions: RailActions): RailView {
  const element = el("nav", "rail");
  const files = iconButton(
    "folder",
    "Files",
    "rail-files",
    actions.toggleFiles,
  );
  const views = iconButton("views", "Views", "rail-views", actions.toggleViews);
  const notes = iconButton("notes", "Notes", "rail-notes", actions.toggleNotes);
  const scan = iconButton("scan", "Scan", "rail-scan", actions.toggleScan);
  const findings = iconButton(
    "findings",
    "Findings",
    "rail-findings",
    actions.toggleFindings,
  );
  const count = el("span", "rail-count");
  const dot = el("span", "rail-dot");
  const found = el("span", "rail-count");

  element.setAttribute("aria-label", "Panels");
  notes.append(count);
  scan.append(dot);
  findings.append(found);
  element.append(files, views, notes, scan, findings);

  for (const one of [files, views, notes, scan, findings]) {
    one.setAttribute("data-label", one.getAttribute("aria-label") ?? "");
    one.removeAttribute("title");
  }

  return {
    element,
    render({ panel, notes: total, scanFailed, findings: badge }) {
      files.classList.toggle("open", panel === "files");
      files.setAttribute("aria-pressed", String(panel === "files"));
      views.classList.toggle("open", panel === "views");
      views.setAttribute("aria-pressed", String(panel === "views"));
      notes.classList.toggle("open", panel === "notes");
      notes.setAttribute("aria-pressed", String(panel === "notes"));
      scan.classList.toggle("open", panel === "scan");
      scan.setAttribute("aria-pressed", String(panel === "scan"));
      findings.classList.toggle("open", panel === "findings");
      findings.setAttribute("aria-pressed", String(panel === "findings"));
      dot.hidden = !scanFailed;
      count.textContent = total > 0 ? String(total) : "";
      count.hidden = total === 0;
      found.className =
        `rail-count ${badge.tone === "none" ? "" : badge.tone}`.trim();
      found.textContent = badge.count > 0 ? String(badge.count) : "";
      found.hidden = badge.count === 0;
    },
  };
}
