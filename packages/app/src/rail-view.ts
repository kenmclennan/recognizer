import { el } from "./dom";
import type { BadgeTone } from "./findings-order";
import { iconButton } from "./icons";

export type LeftPanel =
  | "files"
  | "views"
  | "notes"
  | "scan"
  | "findings"
  | "commits"
  | null;

export type RailActions = {
  toggleFiles: () => void;
  toggleViews: () => void;
  toggleNotes: () => void;
  toggleScan: () => void;
  toggleFindings: () => void;
  toggleCommits: () => void;
  openSetup: () => void;
  openSettings: () => void;
};

export type RailState = {
  panel: LeftPanel;
  notes: number;
  scanFailed: boolean;
  findings: { count: number; tone: BadgeTone };
  setup: { problems: number | null };
};

export type RailView = {
  element: HTMLElement;
  render: (state: RailState) => void;
};

export function setupLabel(problems: number | null): string {
  if (problems === null || problems === 0) {
    return "Setup";
  }

  return problems === 1 ? "Setup: 1 problem" : `Setup: ${problems} problems`;
}

export function buildRailView(actions: RailActions): RailView {
  const element = el("nav", "rail");
  const files = iconButton(
    "folder",
    "Files",
    "rail-files",
    actions.toggleFiles,
  );
  const views = iconButton("views", "Views", "rail-views", actions.toggleViews);
  const notes = iconButton(
    "sticky-note",
    "Notes",
    "rail-notes",
    actions.toggleNotes,
  );
  const scan = iconButton("scan", "Scan", "rail-scan", actions.toggleScan);
  const findings = iconButton(
    "findings",
    "Findings",
    "rail-findings",
    actions.toggleFindings,
  );
  const commits = iconButton(
    "commit",
    "Commits",
    "rail-commits",
    actions.toggleCommits,
  );
  const setup = iconButton("wrench", "Setup", "rail-setup", actions.openSetup);
  const settings = iconButton(
    "settings",
    "Settings",
    "rail-settings",
    actions.openSettings,
  );
  const spacer = el("span", "rail-spacer");
  const count = el("span", "rail-count");
  const dot = el("span", "rail-dot");
  const found = el("span", "rail-count");
  const flagged = el("span", "rail-count amber");

  element.setAttribute("aria-label", "Panels");
  notes.append(count);
  scan.append(dot);
  findings.append(found);
  setup.append(flagged);
  element.append(
    files,
    commits,
    views,
    notes,
    scan,
    findings,
    spacer,
    setup,
    settings,
  );

  for (const one of [
    files,
    views,
    notes,
    scan,
    findings,
    commits,
    setup,
    settings,
  ]) {
    one.setAttribute("data-label", one.getAttribute("aria-label") ?? "");
    one.removeAttribute("title");
  }

  return {
    element,
    render({ panel, notes: total, scanFailed, findings: badge, setup: ready }) {
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
      commits.classList.toggle("open", panel === "commits");
      commits.setAttribute("aria-pressed", String(panel === "commits"));
      dot.hidden = !scanFailed;
      count.textContent = total > 0 ? String(total) : "";
      count.hidden = total === 0;
      found.className =
        `rail-count ${badge.tone === "none" ? "" : badge.tone}`.trim();
      found.textContent = badge.count > 0 ? String(badge.count) : "";
      found.hidden = badge.tone === "none";

      const problems = ready.problems ?? 0;

      flagged.textContent = problems > 0 ? String(problems) : "";
      flagged.hidden = problems === 0;
      setup.setAttribute("data-label", setupLabel(ready.problems));
    },
  };
}
