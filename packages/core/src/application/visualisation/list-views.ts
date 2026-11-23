import { Repository } from "../../domain/repository.js";
import type { StaleReason } from "../../domain/visualisation/stale-reason.js";
import type { ViewChange } from "../../domain/visualisation/view.js";
import { changeFacts } from "./internal/change-facts.js";
import type { VisualisationPorts } from "./internal/visualisation-ports.js";

export interface ListViewsRequest {
  root: string;
}

export type ViewListing =
  | { name: string; error: string }
  | {
      name: string;
      title?: string;
      description: string;
      commit: string | null;
      steps: number;
      change?: ViewChange;
      plan?: true;
      stale: StaleReason[];
    };

export function listViews(
  ports: VisualisationPorts,
  request: ListViewsRequest,
): ViewListing[] {
  const listed = ports.views.names(request.root);
  const repository =
    listed.length === 0
      ? Repository.empty
      : ports.freshRepository(request.root);

  return listed.map((name): ViewListing => {
    const read = ports.views.read(request.root, name);

    if (!read.ok) {
      return { name, error: read.messages.join("; ") };
    }

    const { view } = read;
    const facts =
      view.change === undefined
        ? null
        : changeFacts(ports.git, request.root, view.change);

    return {
      name,
      ...(view.title === undefined ? {} : { title: view.title }),
      description: view.description,
      commit: view.commit,
      steps: view.steps.length,
      ...(view.change === undefined ? {} : { change: view.change }),
      ...(view.plan === true ? { plan: true as const } : {}),
      stale: view.staleReasons(view.resolve(repository).unresolved, facts),
    };
  });
}
