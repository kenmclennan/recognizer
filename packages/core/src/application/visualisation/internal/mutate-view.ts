import type { Repository } from "../../../domain/repository.js";
import type { View } from "../../../domain/visualisation/view.js";
import { checkName, readView } from "./view-access.js";
import type { VisualisationPorts } from "./visualisation-ports.js";

export interface ViewMutation {
  view: string;
  changed: boolean;
  steps: number;
  modules: number;
  what: string;
}

export interface Changed {
  view: View;
  what: string;
}

export function mutateView(
  ports: VisualisationPorts,
  root: string,
  rawName: string | undefined,
  change: (view: View, repository: Repository) => Changed,
): ViewMutation {
  const name = checkName(rawName);
  const before = readView(ports, root, name);
  const repository = ports.freshRepository(root);
  const { view, what } = change(before.clone(), repository);
  const changed = !view.sameContent(before);
  const modules = view.resolve(repository).modules.length;

  if (changed) {
    ports.views.write(root, name, view);
  }

  return { view: name, changed, steps: view.steps.length, modules, what };
}
