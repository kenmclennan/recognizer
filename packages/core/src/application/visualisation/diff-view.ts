import { RequestRefused } from "../../domain/request-refused.js";
import { ViewRange } from "../../domain/visualisation/view-range.js";
import { changeFacts } from "./internal/change-facts.js";
import { checkName, readView } from "./internal/view-access.js";
import type { VisualisationPorts } from "./internal/visualisation-ports.js";
import type { ChangedFile } from "./ports/changes.js";

export interface DiffViewRequest {
  root: string;
  name: string | undefined;
}

export interface ViewDiffed {
  view: string;
  range: string;
  baseCommit: string;
  headCommit: string;
  modules: ChangedFile[];
  unmatched: number;
}

export function diffView(
  ports: VisualisationPorts,
  request: DiffViewRequest,
): ViewDiffed {
  const name = checkName(request.name);
  const view = readView(ports, request.root, name);

  if (view.change === undefined) {
    throw new RequestRefused([`view ${name} is not a change view`]);
  }

  const facts = changeFacts(ports.git, request.root, view.change);

  if (facts.headCommit === null) {
    throw new RequestRefused([
      `head ${view.change.head} is not in the repository`,
    ]);
  }

  if (facts.baseCommit === null) {
    throw new RequestRefused([
      `base ${view.change.base} is not in the repository`,
    ]);
  }

  const repository = ports.freshRepository(request.root);
  const base =
    repository.extractions.length > 0 &&
    repository.extractions.every(
      (extraction) => extraction.commit === facts.baseCommit,
    )
      ? repository
      : null;
  const marks = ports.changes.marks(
    request.root,
    view.change,
    repository,
    base,
  );

  if (marks === null) {
    throw new RequestRefused(["git could not diff the range"]);
  }

  return {
    view: name,
    range: ViewRange.text(view.change),
    baseCommit: facts.baseCommit,
    headCommit: facts.headCommit,
    modules: marks.files,
    unmatched: marks.unmatched,
  };
}
