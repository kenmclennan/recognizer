import { InvalidRequest } from "../../domain/invalid-request.js";
import { checkName } from "./internal/view-access.js";
import type { VisualisationPorts } from "./internal/visualisation-ports.js";

export interface RemoveViewRequest {
  root: string;
  name: string | undefined;
}

export function removeView(
  ports: VisualisationPorts,
  request: RemoveViewRequest,
): { view: string; removed: true } {
  const name = checkName(request.name);

  if (!ports.views.exists(request.root, name)) {
    throw new InvalidRequest([`no such view: ${name}`]);
  }

  ports.views.remove(request.root, name);

  return { view: name, removed: true };
}
