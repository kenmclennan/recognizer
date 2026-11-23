import type { ViewStep } from "../../domain/visualisation/view.js";
import { mutateView, type ViewMutation } from "./internal/mutate-view.js";
import { folderPath } from "./internal/view-access.js";
import { requireFolder } from "./internal/view-checks.js";
import { describeStep, hasStep } from "./internal/view-steps.js";
import type { VisualisationPorts } from "./internal/visualisation-ports.js";

export interface FoldViewRequest {
  root: string;
  name: string | undefined;
  folder: string;
}

export function foldView(
  ports: VisualisationPorts,
  request: FoldViewRequest,
): ViewMutation {
  return mutateView(ports, request.root, request.name, (view, repository) => {
    const folder = folderPath(request.folder);

    requireFolder(repository, folder);

    const step: ViewStep = { kind: "fold", folder };

    if (!hasStep(view, step)) {
      view.steps.push(step);
    }

    return { view, what: `added ${describeStep(step)}` };
  });
}
