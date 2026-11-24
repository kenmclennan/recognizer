import { InvalidRequest } from "../../domain/invalid-request.js";
import { Neighbours } from "../../domain/neighbours.js";
import {
  type Caller,
  CallerIndex,
} from "../../domain/visualisation/caller-index.js";
import type { VisualisationPorts } from "./internal/visualisation-ports.js";

export interface AskCallersRequest {
  root: string;
  module: string;
  name: string;
}

export interface CallersAnswer {
  module: string;
  name: string;
  constructed: boolean;
  callers: Caller[];
}

export function askCallers(
  ports: VisualisationPorts,
  request: AskCallersRequest,
): CallersAnswer {
  const repository = ports.freshRepository(request.root);

  if (!Neighbours.moduleNames(repository).includes(request.module)) {
    throw new InvalidRequest([`no such file: ${request.module}`]);
  }

  const index = CallerIndex.of(repository);

  if (!index.known(request.module)) {
    throw new InvalidRequest([`scan has no call data for ${request.module}`]);
  }

  const { callers, constructed } = index.of(request.module, request.name);

  return { module: request.module, name: request.name, constructed, callers };
}
