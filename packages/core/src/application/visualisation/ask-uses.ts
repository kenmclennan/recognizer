import {
  type AskNeighboursRequest,
  askNeighbours,
  type NeighboursAnswer,
} from "./internal/ask-neighbours.js";
import type { VisualisationPorts } from "./internal/visualisation-ports.js";

export type { AskNeighboursRequest, NeighboursAnswer };

export function askUses(
  ports: VisualisationPorts,
  request: AskNeighboursRequest,
): NeighboursAnswer {
  return askNeighbours(ports, request, "uses");
}
