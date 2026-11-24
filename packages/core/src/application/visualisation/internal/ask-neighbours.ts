import { InvalidRequest } from "../../../domain/invalid-request.js";
import {
  type FolderGroup,
  type NeighbourRow,
  Neighbours,
} from "../../../domain/neighbours.js";
import type { VisualisationPorts } from "./visualisation-ports.js";

export interface AskNeighboursRequest {
  root: string;
  module: string;
}

export interface NeighboursAnswer {
  module: string;
  rows: NeighbourRow[];
  groups: FolderGroup[];
}

export function askNeighbours(
  ports: VisualisationPorts,
  request: AskNeighboursRequest,
  direction: "uses" | "usedBy",
): NeighboursAnswer {
  const repository = ports.freshRepository(request.root);
  const modules = Neighbours.moduleNames(repository);

  if (!modules.includes(request.module)) {
    throw new InvalidRequest([`no such file: ${request.module}`]);
  }

  const neighbours = new Neighbours(repository, modules);
  const rows =
    direction === "uses"
      ? neighbours.usesOf(request.module)
      : neighbours.usedByOf(request.module);

  return {
    module: request.module,
    rows,
    groups: Neighbours.groupByFolder(rows),
  };
}
