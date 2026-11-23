import type { ViewStep } from "../../domain/visualisation/view.js";
import { mutateView, type ViewMutation } from "./internal/mutate-view.js";
import { folderPath } from "./internal/view-access.js";
import { requireFolder } from "./internal/view-checks.js";
import { describeStep } from "./internal/view-steps.js";
import type { VisualisationPorts } from "./internal/visualisation-ports.js";

export interface FocusViewRequest {
  root: string;
  name: string | undefined;
  folder: string;
}

export function focusView(
  ports: VisualisationPorts,
  request: FocusViewRequest,
): ViewMutation {
  return mutateView(ports, request.root, request.name, (view, repository) => {
    const folder = folderPath(request.folder);

    requireFolder(repository, folder);

    const step: ViewStep = { kind: "focus", folder };
    const position = view.steps.findIndex(
      (existing) => existing.kind === "focus",
    );

    if (position === -1) {
      view.steps.push(step);
    } else {
      view.steps[position] = step;
    }

    return { view, what: `set ${describeStep(step)}` };
  });
}
