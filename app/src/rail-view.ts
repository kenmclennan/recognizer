import { el } from "./dom";
import { iconButton } from "./icons";

export type RailActions = {
  toggleFiles: () => void;
};

export type RailView = {
  element: HTMLElement;
  render: (filesOpen: boolean) => void;
};

export function buildRailView(actions: RailActions): RailView {
  const element = el("nav", "rail");
  const files = iconButton(
    "folder",
    "Files",
    "rail-files",
    actions.toggleFiles,
  );

  element.setAttribute("aria-label", "Panels");
  element.append(files);

  return {
    element,
    render(filesOpen) {
      files.classList.toggle("open", filesOpen);
      files.setAttribute("aria-pressed", String(filesOpen));
    },
  };
}
