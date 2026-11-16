import type { KeyAction } from "./canvas-keys";
import type { BarActions, BarModel } from "./selection-bar-view";

export type BarPanel = "contents" | "dependencies" | "findings" | "notes";

export type PanelActions = Pick<
  BarActions,
  "openTab" | "openContents" | "openNote" | "closeInspector" | "closeNote"
>;

export function panelShown(model: BarModel, panel: BarPanel): boolean {
  if (panel === "notes") {
    return model.notes?.open === true;
  }

  if (panel === "contents") {
    return (
      model.inspectorTab === "contents" || model.inspectorTab === "findings"
    );
  }

  return model.inspectorTab === panel;
}

export function pressPanel(
  model: BarModel,
  panel: BarPanel,
  actions: PanelActions,
): void {
  const shown = panelShown(model, panel);

  if (panel === "notes") {
    shown ? actions.closeNote() : actions.openNote();
  } else if (shown) {
    actions.closeInspector();
  } else if (panel === "contents") {
    actions.openContents();
  } else {
    actions.openTab(panel);
  }
}

const KEY_PANELS: Partial<Record<KeyAction, BarPanel>> = {
  contents: "contents",
  dependencies: "dependencies",
  findings: "findings",
  "add-note": "notes",
};

export function pressKey(
  action: KeyAction,
  model: BarModel | null,
  actions: PanelActions,
): boolean {
  const panel = KEY_PANELS[action];

  if (panel === undefined || model === null) {
    return false;
  }

  if (panel === "findings" && model.findings === null) {
    return true;
  }

  if (panel === "notes" && model.notes === null) {
    return false;
  }

  pressPanel(model, panel, actions);

  return true;
}
