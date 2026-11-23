import { View, type ViewStep } from "../../../domain/visualisation/view.js";

export function describeStep(step: ViewStep): string {
  switch (step.kind) {
    case "pick":
      return `pick ${step.module}`;
    case "left-out":
      return `left-out ${step.module}`;
    case "fold":
      return `fold ${step.folder}`;
    case "focus":
      return `focus ${step.folder}`;
    case "rule":
      return `rule ${step.relation} ${step.of}${step.relation !== "folder" && step.within !== undefined ? ` within ${step.within}` : ""}`;
  }
}

export function hasStep(view: View, step: ViewStep): boolean {
  const wanted = JSON.stringify(View.orderedStep(step));

  return view.steps.some(
    (existing) => JSON.stringify(View.orderedStep(existing)) === wanted,
  );
}
