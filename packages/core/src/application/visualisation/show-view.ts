import type { Repository } from "../../domain/repository.js";
import type { ResolvedView, View } from "../../domain/visualisation/view.js";
import { checkName, readView } from "./internal/view-access.js";
import type { VisualisationPorts } from "./internal/visualisation-ports.js";

export interface ShowViewRequest {
  root: string;
  name: string | undefined;
}

export interface ViewShown {
  name: string;
  view: View;
  resolved: ResolvedView;
  warnings: string[];
}

export function showView(
  ports: VisualisationPorts,
  request: ShowViewRequest,
): ViewShown {
  const name = checkName(request.name);
  const view = readView(ports, request.root, name);
  const repository: Repository = ports.freshRepository(request.root);
  const resolved = view.resolve(repository);

  return {
    name,
    view,
    resolved,
    warnings: [
      ...view.noteWarnings(),
      ...view.proposedWarnings(resolved, repository),
    ],
  };
}
