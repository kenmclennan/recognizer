export type PanelName = "tree" | "inspector" | "commits";

export type PanelWidths = {
  tree: number;
  inspector: number;
  commits: number;
};

export const PANEL_LIMITS = {
  tree: { min: 200, max: 480, initial: 280 },
  inspector: { min: 280, max: 640, initial: 340 },
  commits: { min: 260, max: 640, initial: 340 },
};

export const PANEL_WIDTHS_KEY = "recognizer.panel-widths";

export function clampWidth(panel: PanelName, px: number): number {
  const { min, max, initial } = PANEL_LIMITS[panel];

  if (!Number.isFinite(px)) {
    return initial;
  }

  return Math.min(max, Math.max(min, Math.round(px)));
}

function fieldOf(parsed: unknown, panel: PanelName): number {
  const value =
    typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)[panel]
      : undefined;

  return clampWidth(panel, typeof value === "number" ? value : Number.NaN);
}

export function loadWidths(storage: Pick<Storage, "getItem">): PanelWidths {
  let parsed: unknown = null;

  try {
    const text = storage.getItem(PANEL_WIDTHS_KEY);

    parsed = text === null ? null : JSON.parse(text);
  } catch {
    parsed = null;
  }

  return {
    tree: fieldOf(parsed, "tree"),
    inspector: fieldOf(parsed, "inspector"),
    commits: fieldOf(parsed, "commits"),
  };
}

export function saveWidths(
  storage: Pick<Storage, "setItem">,
  widths: PanelWidths,
): void {
  try {
    storage.setItem(PANEL_WIDTHS_KEY, JSON.stringify(widths));
  } catch {
    return;
  }
}

export function dragWidth(
  panel: PanelName,
  startWidth: number,
  startX: number,
  currentX: number,
  count = 1,
): number {
  const delta = (currentX - startX) / Math.max(1, count);

  return clampWidth(
    panel,
    panel === "inspector" ? startWidth - delta : startWidth + delta,
  );
}
