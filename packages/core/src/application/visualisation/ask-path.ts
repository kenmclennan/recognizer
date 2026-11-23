import { InvalidRequest } from "../../domain/invalid-request.js";
import {
  Neighbours,
  type PathStep,
} from "../../domain/visualisation/neighbours.js";
import type { VisualisationPorts } from "./internal/visualisation-ports.js";

export interface AskPathRequest {
  root: string;
  from: string;
  to: string;
}

export interface PathAnswer {
  from: string;
  to: string;
  steps: PathStep[] | null;
}

export function askPath(
  ports: VisualisationPorts,
  request: AskPathRequest,
): PathAnswer {
  const repository = ports.freshRepository(request.root);
  const modules = Neighbours.moduleNames(repository);

  for (const path of [request.from, request.to]) {
    if (!modules.includes(path)) {
      throw new InvalidRequest([`no such file: ${path}`]);
    }
  }

  return {
    from: request.from,
    to: request.to,
    steps: new Neighbours(repository, modules).shortestPath(
      request.from,
      request.to,
    ),
  };
}
