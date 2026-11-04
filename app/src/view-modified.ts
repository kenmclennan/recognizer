import { resolveView, type Scan, serialiseView, type View } from "recognizer";
import { type CanvasContent, stepsFor } from "./view-steps";

function contentOf(view: View, scans: Scan[]): CanvasContent {
  const resolved = resolveView(view, scans);

  return {
    modules: resolved.modules,
    folded: resolved.folded,
    focus: resolved.focus,
  };
}

export function viewModified(
  saved: View,
  canvas: CanvasContent,
  scans: Scan[],
): boolean {
  const candidate = serialiseView({
    ...saved,
    steps: stepsFor(saved.steps, canvas, scans),
  });
  const baseline = serialiseView({
    ...saved,
    steps: stepsFor(saved.steps, contentOf(saved, scans), scans),
  });

  return candidate !== baseline;
}
