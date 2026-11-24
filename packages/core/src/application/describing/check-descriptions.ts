import { Neighbours } from "../../domain/neighbours.js";
import type { Repository } from "../../domain/repository.js";
import { requireKnownFiles } from "./describe-modules.js";
import type { DescribingPorts } from "./internal/describing-ports.js";
import { subjectFor } from "./internal/subjects.js";
import type { DescriberRef } from "./ports/describer-ref.js";

export interface CheckDescriptionsRequest {
  root: string;
  repository: Repository;
  describer: DescriberRef;
  names: string[];
}

export interface DescriptionRow {
  module: string;
  status: "current" | "out-of-date" | "missing" | "unreadable";
  line: string | null;
  reasons: ("source" | "describer" | "version")[];
}

export interface DescriptionsCheck {
  ok: boolean;
  counts: {
    current: number;
    outOfDate: number;
    missing: number;
    unreadable: number;
  };
  modules: DescriptionRow[];
  gone: string[];
}

export function checkDescriptions(
  ports: DescribingPorts,
  request: CheckDescriptionsRequest,
): DescriptionsCheck {
  const { root, repository, names } = request;
  const lines = ports.responsibilities.read(root);
  const known = Neighbours.moduleNames(repository);

  requireKnownFiles(repository, names);

  const ids = (names.length > 0 ? names : known).slice().sort();
  const subjects = ids.map((id) =>
    subjectFor(
      (path) => ports.describer.readSource(root, path),
      repository,
      id,
      lines,
      request.describer,
    ),
  );
  const gone =
    names.length > 0 ? [] : lines.ids().filter((id) => !known.includes(id));
  const counts = { current: 0, outOfDate: 0, missing: 0, unreadable: 0 };

  const rows = subjects.map((subject): DescriptionRow => {
    const status = subject.status.status;

    if (status === "current") {
      counts.current += 1;
    } else if (status === "out-of-date") {
      counts.outOfDate += 1;
    } else if (status === "missing") {
      counts.missing += 1;
    } else {
      counts.unreadable += 1;
    }

    return {
      module: subject.id,
      status,
      line: lines.get(subject.id)?.line ?? null,
      reasons:
        subject.status.status === "out-of-date" ? subject.status.reasons : [],
    };
  });

  return {
    ok: rows.every((row) => row.status === "current"),
    counts,
    modules: rows,
    gone,
  };
}
