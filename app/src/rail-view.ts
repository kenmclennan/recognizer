import { el } from "./dom";
import { iconButton } from "./icons";

export type LeftPanel = "files" | "notes" | "sensors" | null;

export type RailActions = {
  toggleFiles: () => void;
  toggleNotes: () => void;
  toggleSensors: () => void;
};

export type RailState = {
  panel: LeftPanel;
  notes: number;
  sensorsFailed: boolean;
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
  const count = el("span", "rail-count");
  const dot = el("span", "rail-dot");

  element.setAttribute("aria-label", "Panels");
  notes.append(count);
  sensors.append(dot);
  element.append(files, notes, sensors);

  for (const one of [files, notes, sensors]) {
    one.setAttribute("data-label", one.getAttribute("aria-label") ?? "");
    one.removeAttribute("title");
  }

  return {
    element,
    render({ panel, notes: total, sensorsFailed }) {
      files.classList.toggle("open", panel === "files");
      files.setAttribute("aria-pressed", String(panel === "files"));
      notes.classList.toggle("open", panel === "notes");
      notes.setAttribute("aria-pressed", String(panel === "notes"));
      sensors.classList.toggle("open", panel === "sensors");
      sensors.setAttribute("aria-pressed", String(panel === "sensors"));
      dot.hidden = !sensorsFailed;
      count.textContent = total > 0 ? String(total) : "";
      count.hidden = total === 0;
    },
  };
}
