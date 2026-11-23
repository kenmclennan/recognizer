import {
  type AskNeighboursRequest,
  askNeighbours,
  type NeighboursAnswer,
} from "./internal/ask-neighbours.js";
import type { VisualisationPorts } from "./internal/visualisation-ports.js";

export function askUsedBy(
  ports: VisualisationPorts,
  request: AskNeighboursRequest,
): NeighboursAnswer {
  return askNeighbours(ports, request, "usedBy");
}
