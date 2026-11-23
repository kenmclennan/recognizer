import { InvalidRequest } from "../../domain/invalid-request.js";
import type { ViewStep } from "../../domain/visualisation/view.js";
import { mutateView, type ViewMutation } from "./internal/mutate-view.js";
import { folderPath } from "./internal/view-access.js";
import { requireFolder, requireModules } from "./internal/view-checks.js";
import { describeStep, hasStep } from "./internal/view-steps.js";
import type { VisualisationPorts } from "./internal/visualisation-ports.js";

export interface RuleViewRequest {
  root: string;
  name: string | undefined;
  folder: string | undefined;
  uses: string | undefined;
  usedBy: string | undefined;
  within: string | undefined;
  usage: string;
}

export function ruleView(
  ports: VisualisationPorts,
  request: RuleViewRequest,
): ViewMutation {
  return mutateView(ports, request.root, request.name, (view, repository) => {
    const given = {
      folder: request.folder,
      uses: request.uses,
      "used-by": request.usedBy,
    };
    const relations = (["folder", "uses", "used-by"] as const).filter(
      (relation) => given[relation] !== undefined,
    );

    if (relations.length !== 1) {
      throw new InvalidRequest([
        "exactly one of --folder, --uses or --used-by is required",
        `usage: ${request.usage}`,
      ]);
    }

    const relation = relations[0] as "folder" | "uses" | "used-by";
    const within =
      request.within === undefined ? undefined : folderPath(request.within);

    if (relation === "folder" && within !== undefined) {
      throw new InvalidRequest(["--within does not apply to --folder"]);
    }

    let step: ViewStep;

    if (relation === "folder") {
      const of = folderPath(given.folder as string);

      requireFolder(repository, of);
      step = { kind: "rule", relation, of };
    } else {
      const of = given[relation] as string;

      requireModules(repository, [of]);

      if (within !== undefined) {
        requireFolder(repository, within);
      }

      step = {
        kind: "rule",
        relation,
        of,
        ...(within === undefined ? {} : { within }),
      };
    }

    if (!hasStep(view, step)) {
      view.steps.push(step);
    }

    return { view, what: `added ${describeStep(step)}` };
  });
}
