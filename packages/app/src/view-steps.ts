import { resolveView, type Scan, type ViewStep } from "recognizer";

export type CanvasContent = {
  modules: string[];
  folded: string[];
  focus: string | null;
};

function resolved(steps: ViewStep[], scans: Scan[]): Set<string> {
  return new Set(
    resolveView(
      { schema_version: 1, description: "-", commit: null, steps },
      scans,
    ).modules,
  );
}

export function stepsFor(
  base: ViewStep[],
  canvas: CanvasContent,
  scans: Scan[],
): ViewStep[] {
  const onCanvas = new Set(canvas.modules);
  let steps: ViewStep[] = base.filter(
    (step) => step.kind !== "fold" && step.kind !== "focus",
  );

  for (const module of resolved(steps, scans)) {
    if (onCanvas.has(module)) {
      continue;
    }

    steps = steps.filter(
      (step) => !(step.kind === "pick" && step.module === module),
    );

    if (resolved(steps, scans).has(module)) {
      steps.push({ kind: "left-out", module });
    }
  }

  for (const module of canvas.modules) {
    if (resolved(steps, scans).has(module)) {
      continue;
    }

    steps = steps.filter(
      (step) => !(step.kind === "left-out" && step.module === module),
    );

    if (!resolved(steps, scans).has(module)) {
      steps.push({ kind: "pick", module });
    }
  }

  for (const folder of [...canvas.folded].sort()) {
    steps.push({ kind: "fold", folder });
  }

  if (canvas.focus !== null) {
    steps.push({ kind: "focus", folder: canvas.focus });
  }

  return steps;
}
