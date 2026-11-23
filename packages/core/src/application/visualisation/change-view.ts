import { InvalidRequest } from "../../domain/invalid-request.js";
import { View } from "../../domain/visualisation/view.js";
import { mutateView, type ViewMutation } from "./internal/mutate-view.js";
import {
  checkMemberProposed,
  checkProposed,
  parseKind,
  requireMemberTarget,
  requireNoMemberEntries,
  requirePlan,
  requireScanFor,
  withProposed,
} from "./internal/view-checks.js";
import type { VisualisationPorts } from "./internal/visualisation-ports.js";

export interface ChangeViewRequest {
  root: string;
  name: string | undefined;
  target: string;
  kind: string | undefined;
  clear: boolean;
  from: string | undefined;
  usage: string;
}

export function changeView(
  ports: VisualisationPorts,
  request: ChangeViewRequest,
): ViewMutation {
  return mutateView(ports, request.root, request.name, (view, repository) => {
    const target = request.target;
    const kindText = request.kind;
    const clearing = request.clear;

    requirePlan(view, "views change");

    if (clearing === (kindText !== undefined)) {
      throw new InvalidRequest([`usage: ${request.usage}`]);
    }

    if (target.includes("#")) {
      const split = View.splitMemberReference(target);

      if (split === null) {
        throw new InvalidRequest([`not a member reference: ${target}`]);
      }

      if (clearing) {
        if (
          !view
            .memberProposed()
            .some((e) => e.module === split.module && e.member === split.member)
        ) {
          throw new InvalidRequest([`no proposed change on ${target}`]);
        }

        return {
          view: withProposed(view, null, split.module, split.member),
          what: `cleared the proposed change on ${target}`,
        };
      }

      const memberEntry = checkMemberProposed(
        parseKind(kindText as string),
        target,
        request.from,
      );

      requireMemberTarget(view, repository, memberEntry);

      return {
        view: withProposed(view, memberEntry, split.module, split.member),
        what: `set the proposed change on ${target} to ${memberEntry.kind}`,
      };
    }

    const module = target;
    const resolved = view.resolve(repository);
    const planned = resolved.planned.includes(module);

    if (!planned && !resolved.modules.includes(module)) {
      throw new InvalidRequest([`${module} is not on the view`]);
    }

    if (clearing) {
      if (planned) {
        throw new InvalidRequest([
          `${module} is planned; remove it with views remove`,
        ]);
      }

      if (!view.proposedList().some((entry) => entry.module === module)) {
        throw new InvalidRequest([`no proposed change on ${module}`]);
      }

      return {
        view: withProposed(view, null, module),
        what: `cleared the proposed change on ${module}`,
      };
    }

    const entry = checkProposed(
      parseKind(kindText as string),
      module,
      request.from,
    );

    requireNoMemberEntries(view, entry);
    requireScanFor(repository, entry);

    return {
      view: withProposed(view, entry, module),
      what: `set the proposed change on ${module} to ${entry.kind}`,
    };
  });
}
