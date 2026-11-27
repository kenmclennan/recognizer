import type {
  FoldSummary as CoreFoldSummary,
  SuiteState as CoreSuiteState,
} from "@recognizer/core";
import type { IconName } from "./icons";

export type SuiteTone = "ok" | "bad" | "muted" | "run";

export type SuiteLook = { icon: IconName; tone: SuiteTone };

export type SuiteState = CoreSuiteState & SuiteLook;

export type SuiteRowModel = {
  sensor: string;
  name: string;
  tag: string;
  ticked: boolean;
  disabled: boolean;
  state: SuiteState;
};

export type FoldSummary = SuiteLook & { text: string };

export const LOOK: Record<CoreSuiteState["kind"], SuiteLook> = {
  ok: { icon: "circle-check", tone: "ok" },
  failed: { icon: "circle-x", tone: "bad" },
  partial: { icon: "circle-pause", tone: "muted" },
  never: { icon: "circle-dashed", tone: "muted" },
  running: { icon: "loader", tone: "run" },
};

export function lookedState(state: CoreSuiteState): SuiteState {
  return { ...state, ...LOOK[state.kind] };
}

export function lookedFold(summary: CoreFoldSummary): FoldSummary {
  return { text: summary.text, ...LOOK[summary.kind] };
}
