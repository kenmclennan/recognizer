import { InvalidRequest } from "../../domain/invalid-request.js";
import { ViewRange } from "../../domain/visualisation/view-range.js";
import { mutateView, type ViewMutation } from "./internal/mutate-view.js";
import { parseChangeFlag } from "./internal/view-access.js";
import type { VisualisationPorts } from "./internal/visualisation-ports.js";

export interface SetViewRequest {
  root: string;
  name: string | undefined;
  change: string | undefined;
  title: string | undefined;
  description: string | undefined;
  plan: boolean;
  noPlan: boolean;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function setView(
  ports: VisualisationPorts,
  request: SetViewRequest,
): ViewMutation {
  const { change: changeFlag, title, description } = request;

  if (request.plan && request.noPlan) {
    throw new InvalidRequest(["--plan and --no-plan cannot be combined"]);
  }

  if (request.plan && changeFlag !== undefined && changeFlag !== "none") {
    throw new InvalidRequest(["a view is never both a plan and a change view"]);
  }

  if (description !== undefined && description.trim() === "") {
    throw new InvalidRequest(["--description must not be blank"]);
  }

  const change =
    changeFlag !== undefined && changeFlag !== "none"
      ? parseChangeFlag(ports, request.root, changeFlag)
      : undefined;

  return mutateView(ports, request.root, request.name, (view) => {
    let migrated = view.migrated();
    const what: string[] = [];

    if (title !== undefined) {
      const trimmed = title.trim();

      if (trimmed === "") {
        migrated = migrated.with({ title: undefined });
        what.push("removed the title");
      } else {
        migrated = migrated.with({ title: trimmed });
        what.push("set the title");
      }
    }

    if (description !== undefined) {
      migrated = migrated.with({ description });
      what.push("set the description");
    }

    if (request.plan) {
      if (migrated.change !== undefined && changeFlag !== "none") {
        throw new InvalidRequest([
          "a view is never both a plan and a change view",
        ]);
      }

      if (changeFlag === "none") {
        migrated = migrated.with({ change: undefined });
      }

      migrated = migrated.with({ plan: true });
      what.push("made it a plan");
    }

    if (request.noPlan && migrated.plan === true) {
      const dropped = migrated.proposedList().length;

      migrated = migrated.with({ plan: undefined, proposed: undefined });
      what.push(
        `cleared the plan, dropped ${plural(dropped, "proposed change")}`,
      );
    }

    if (changeFlag !== undefined && !request.plan) {
      if (change !== undefined && migrated.plan === true) {
        throw new InvalidRequest([
          "a view is never both a plan and a change view",
        ]);
      }

      if (change === undefined) {
        migrated = migrated.with({ change: undefined });
        what.push("removed the range");
      } else {
        migrated = migrated.with({ change });
        what.push(`set the range to ${ViewRange.text(change)}`);
      }
    }

    return { view: migrated, what: what.join(", ") };
  });
}
