import { InvalidRequest } from "../../domain/invalid-request.js";
import { View } from "../../domain/visualisation/view.js";
import { mutateView, type ViewMutation } from "./internal/mutate-view.js";
import { folderPath } from "./internal/view-access.js";
import { withoutMemberEntries, withProposed } from "./internal/view-checks.js";
import type { VisualisationPorts } from "./internal/visualisation-ports.js";

export interface RemoveFromViewRequest {
  root: string;
  name: string | undefined;
  path: string;
  fold: boolean;
  focus: boolean;
  rule: string | undefined;
  within: string | undefined;
}

const RELATIONS = ["folder", "uses", "used-by"];

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function removeFromView(
  ports: VisualisationPorts,
  request: RemoveFromViewRequest,
): ViewMutation {
  return mutateView(ports, request.root, request.name, (view, repository) => {
    const path = request.path;
    const chosen = [
      request.fold,
      request.focus,
      request.rule !== undefined,
    ].filter(Boolean).length;

    if (chosen > 1) {
      throw new InvalidRequest([
        "use at most one of --fold, --focus and --rule",
      ]);
    }

    if (request.within !== undefined && request.rule === undefined) {
      throw new InvalidRequest(["--within needs --rule"]);
    }

    if (request.fold || request.focus) {
      const kind = request.fold ? "fold" : "focus";
      const folder = folderPath(path);
      const kept = view.steps.filter(
        (s) => !(s.kind === kind && s.folder === folder),
      );

      if (kept.length === view.steps.length) {
        throw new InvalidRequest([`no ${kind} step for ${folder}`]);
      }

      view.steps = kept;

      return { view, what: `removed ${kind} ${folder}` };
    }

    if (request.rule !== undefined) {
      const relation = request.rule;

      if (!RELATIONS.includes(relation)) {
        throw new InvalidRequest([
          `--rule takes ${RELATIONS.join(", ")}, not ${relation}`,
        ]);
      }

      const of = relation === "folder" ? folderPath(path) : path;
      const within =
        request.within === undefined ? undefined : folderPath(request.within);
      const kept = view.steps.filter(
        (s) =>
          !(
            s.kind === "rule" &&
            s.relation === relation &&
            s.of === of &&
            (s.relation === "folder" ? undefined : s.within) === within
          ),
      );

      if (kept.length === view.steps.length) {
        throw new InvalidRequest([`no ${relation} rule for ${of}`]);
      }

      view.steps = kept;

      return { view, what: `removed rule ${relation} ${of}` };
    }

    const split = path.includes("#") ? View.splitMemberReference(path) : null;

    if (path.includes("#") && split === null) {
      throw new InvalidRequest([`not a member reference: ${path}`]);
    }

    if (split !== null) {
      if (
        !view
          .memberProposed()
          .some((e) => e.module === split.module && e.member === split.member)
      ) {
        throw new InvalidRequest([`no proposed change on ${path}`]);
      }

      return {
        view: withProposed(view, null, split.module, split.member),
        what: `removed the proposed change on ${path}`,
      };
    }

    const before = view.resolve(repository);

    if (before.planned.includes(path)) {
      const [dropped, count] = withoutMemberEntries(view, path);

      return {
        view: withProposed(dropped, null, path),
        what: `removed the planned file ${path}${count > 0 ? `, dropped ${plural(count, "member entry")}` : ""}`,
      };
    }

    if (!before.modules.includes(path)) {
      throw new InvalidRequest([`${path} is not on the view`]);
    }

    view.steps = view.steps.filter(
      (s) => !(s.kind === "pick" && s.module === path),
    );

    if (view.resolve(repository).modules.includes(path)) {
      view.steps.push({ kind: "left-out", module: path });
    }

    const [stripped, dropped] = withoutMemberEntries(view, path);

    return {
      view: withProposed(stripped, null, path),
      what: `took ${path} off${dropped > 0 ? `, dropped ${plural(dropped, "member entry")}` : ""}`,
    };
  });
}
