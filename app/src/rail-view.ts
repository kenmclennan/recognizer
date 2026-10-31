import { el } from "./dom";
import type { BadgeTone } from "./findings-order";
import { iconButton } from "./icons";

export type LeftPanel = "files" | "notes" | "sensors" | "findings" | null;

export type RailActions = {
  toggleFiles: () => void;
  toggleNotes: () => void;
  toggleSensors: () => void;
  toggleFindings: () => void;
};

export type RailState = {
  panel: LeftPanel;
  notes: number;
  sensorsFailed: boolean;
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
  const notes = iconButton("notes", "Notes", "rail-notes", actions.toggleNotes);
  const sensors = iconButton(
    "sensors",
    "Sensors",
    "rail-sensors",
    actions.toggleSensors,
  );
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
  sensors.append(dot);
  findings.append(found);
  element.append(files, notes, sensors, findings);

  for (const one of [files, notes, sensors, findings]) {
    one.setAttribute("data-label", one.getAttribute("aria-label") ?? "");
    one.removeAttribute("title");
  }

  return {
    element,
    render({ panel, notes: total, sensorsFailed, findings: badge }) {
      files.classList.toggle("open", panel === "files");
      files.setAttribute("aria-pressed", String(panel === "files"));
      notes.classList.toggle("open", panel === "notes");
      notes.setAttribute("aria-pressed", String(panel === "notes"));
      sensors.classList.toggle("open", panel === "sensors");
      sensors.setAttribute("aria-pressed", String(panel === "sensors"));
      findings.classList.toggle("open", panel === "findings");
      findings.setAttribute("aria-pressed", String(panel === "findings"));
      dot.hidden = !sensorsFailed;
      count.textContent = total > 0 ? String(total) : "";
      count.hidden = total === 0;
      found.className =
        `rail-count ${badge.tone === "none" ? "" : badge.tone}`.trim();
      found.textContent = badge.count > 0 ? String(badge.count) : "";
      found.hidden = badge.count === 0;
    },
  };
}
