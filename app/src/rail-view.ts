import { el } from "./dom";
import { iconButton } from "./icons";

export type LeftPanel = "files" | "notes" | null;

export type RailActions = {
  toggleFiles: () => void;
  toggleNotes: () => void;
};

export type RailState = { panel: LeftPanel; notes: number };

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
  const count = el("span", "rail-count");

  element.setAttribute("aria-label", "Panels");
  notes.append(count);
  element.append(files, notes);

  return {
    element,
    render({ panel, notes: total }) {
      files.classList.toggle("open", panel === "files");
      files.setAttribute("aria-pressed", String(panel === "files"));
      notes.classList.toggle("open", panel === "notes");
      notes.setAttribute("aria-pressed", String(panel === "notes"));
      count.textContent = total > 0 ? String(total) : "";
      count.hidden = total === 0;
    },
  };
}
