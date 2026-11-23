import { InvalidRequest } from "../../domain/invalid-request.js";
import { Neighbours } from "../../domain/visualisation/neighbours.js";
import type { ViewProposedChange } from "../../domain/visualisation/view.js";
import { mutateView, type ViewMutation } from "./internal/mutate-view.js";
import {
  checkMemberProposed,
  checkProposed,
  parseKind,
  requireMemberTarget,
  requireModules,
  requireNoMemberEntries,
  requirePlan,
  requireScanFor,
  withProposed,
} from "./internal/view-checks.js";
import type { VisualisationPorts } from "./internal/visualisation-ports.js";

export interface AddToViewRequest {
  root: string;
  name: string | undefined;
  paths: string[];
  change: string | undefined;
  from: string | undefined;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function addToView(
  ports: VisualisationPorts,
  request: AddToViewRequest,
): ViewMutation {
  return mutateView(ports, request.root, request.name, (view, repository) => {
    const paths = [...new Set(request.paths)];
    const kindFlag = request.change;
    const fromFlag = request.from;

    if (kindFlag === undefined && fromFlag !== undefined) {
      throw new InvalidRequest(["--from needs --change"]);
    }

    let entries: ViewProposedChange[] = [];

    if (kindFlag !== undefined) {
      requirePlan(view, "--change");

      const kind = parseKind(kindFlag);

      if (fromFlag !== undefined && paths.length !== 1) {
        throw new InvalidRequest(["--from takes exactly one file"]);
      }

      entries = paths.map((path) =>
        path.includes("#")
          ? checkMemberProposed(kind, path, fromFlag)
          : checkProposed(kind, path, fromFlag),
      );

      for (const entry of entries) {
        if (entry.member === undefined) {
          requireNoMemberEntries(view, entry);
          requireScanFor(repository, entry);
        } else {
          requireMemberTarget(view, repository, entry);
        }
      }
    } else {
      if (paths.some((path) => path.includes("#"))) {
        throw new InvalidRequest([
          "a member reference needs --change new, changes or removed",
        ]);
      }

      requireModules(repository, paths);
    }

    const known = new Set(Neighbours.moduleNames(repository));
    const targets = entries.length === 0 ? paths : entries.map((e) => e.module);
    const toPick =
      entries.length === 0
        ? paths
        : [...new Set(targets)].filter((p) => known.has(p));
    const picked = new Set(
      view.steps.flatMap((s) => (s.kind === "pick" ? [s.module] : [])),
    );
    const added = toPick.filter((path) => !picked.has(path));

    view.steps = view.steps.filter(
      (s) => !(s.kind === "left-out" && targets.includes(s.module)),
    );
    view.steps.push(
      ...added.map((module) => ({ kind: "pick" as const, module })),
    );

    let next = view;

    for (const entry of entries) {
      next = withProposed(next, entry, entry.module, entry.member);
    }

    return {
      view: next,
      what:
        entries.length === 0
          ? `added ${plural(added.length, "pick")}`
          : `added ${plural(added.length, "pick")}, set ${plural(entries.length, "proposed change")}`,
    };
  });
}
