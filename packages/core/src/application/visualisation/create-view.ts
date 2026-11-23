import { InvalidRequest } from "../../domain/invalid-request.js";
import type { Repository } from "../../domain/repository.js";
import {
  View,
  type ViewChange,
  type ViewStep,
} from "../../domain/visualisation/view.js";
import type { ViewMutation } from "./internal/mutate-view.js";
import {
  checkName,
  folderPath,
  parseChangeFlag,
} from "./internal/view-access.js";
import { requireModules } from "./internal/view-checks.js";
import type { VisualisationPorts } from "./internal/visualisation-ports.js";

export interface CreateViewRequest {
  root: string;
  name: string | undefined;
  description: string | undefined;
  change: string | undefined;
  plan: boolean;
  fromWindow: string | undefined;
}

function byText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function windowSteps(
  ports: VisualisationPorts,
  root: string,
  id: string,
): { steps: ViewStep[]; repository: Repository } {
  const state = ports.windows.stateOf(id);

  if (folderPath(state.folder) !== folderPath(root)) {
    throw new InvalidRequest([
      `${state.id} shows ${state.folder}, not ${root}`,
    ]);
  }

  const repository = ports.freshRepository(root);

  requireModules(repository, state.modules);

  return {
    steps: [
      ...[...state.modules]
        .sort(byText)
        .map((module) => ({ kind: "pick" as const, module })),
      ...[...state.folded]
        .sort(byText)
        .map((folder) => ({ kind: "fold" as const, folder })),
      ...(state.focus === null
        ? []
        : [{ kind: "focus" as const, folder: state.focus }]),
    ],
    repository,
  };
}

export function createView(
  ports: VisualisationPorts,
  request: CreateViewRequest,
): ViewMutation {
  const name = checkName(request.name);
  const { description } = request;

  if (description === undefined || description.trim() === "") {
    throw new InvalidRequest([
      "--description is required and must not be blank",
    ]);
  }

  if (ports.views.exists(request.root, name)) {
    throw new InvalidRequest([`view already exists: ${name}`]);
  }

  if (request.plan && request.change !== undefined) {
    throw new InvalidRequest(["a plan has no change range"]);
  }

  const change: ViewChange | undefined =
    request.change === undefined
      ? undefined
      : parseChangeFlag(ports, request.root, request.change);
  const fromWindow =
    request.fromWindow === undefined
      ? null
      : windowSteps(ports, request.root, request.fromWindow);
  const view = View.of({
    schema_version: 4,
    description,
    commit: ports.git.commit(request.root),
    ...(change === undefined ? {} : { change }),
    ...(request.plan ? { plan: true as const } : {}),
    steps: fromWindow?.steps ?? [],
  });

  ports.views.write(request.root, name, view);

  const modules = fromWindow
    ? view.resolve(fromWindow.repository).modules.length
    : 0;

  return {
    view: name,
    changed: true,
    steps: view.steps.length,
    modules,
    what: "created",
  };
}
