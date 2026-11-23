import type { Repository, View } from "@recognizer/core";
import { type CanvasContent, stepsFor } from "./view-steps";

function contentOf(view: View, scans: Repository): CanvasContent {
  const resolved = view.resolve(scans);

  return {
    modules: resolved.modules,
    folded: resolved.folded,
    focus: resolved.focus,
  };
}

export function viewModified(
  saved: View,
  canvas: CanvasContent,
  scans: Repository,
): boolean {
  const candidate = saved.with({
    steps: stepsFor(saved.steps, canvas, scans),
  });
  const baseline = saved.with({
    steps: stepsFor(saved.steps, contentOf(saved, scans), scans),
  });

  return !candidate.sameContent(baseline);
}
