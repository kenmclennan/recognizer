import { InvalidRequest } from "../../domain/invalid-request.js";
import type { Repository } from "../../domain/repository.js";
import type { DescribingPorts } from "./internal/describing-ports.js";
import { subjectFor } from "./internal/subjects.js";
import type { DescriberRef } from "./ports/describer-ref.js";

export interface ReadResponsibilityRequest {
  root: string;
  repository: Repository;
  id: string;
  describer: DescriberRef | null;
}

export interface ResponsibilityRead {
  status: "current" | "out-of-date" | "missing" | "unchecked";
  line: string | null;
}

export function readResponsibility(
  ports: DescribingPorts,
  request: ReadResponsibilityRequest,
): ResponsibilityRead {
  const { root, repository, id, describer } = request;
  let lines: ReturnType<DescribingPorts["responsibilities"]["read"]>;

  try {
    lines = ports.responsibilities.read(root);
  } catch (error) {
    if (InvalidRequest.is(error)) {
      return { status: "unchecked", line: null };
    }

    throw error;
  }

  const entry = lines.get(id);

  if (entry === undefined) {
    return { status: "missing", line: null };
  }

  if (describer === null) {
    return { status: "unchecked", line: entry.line };
  }

  const subject = subjectFor(
    (path) => ports.describer.readSource(root, path),
    repository,
    id,
    lines,
    describer,
  );
  const status = subject.status.status;

  return {
    status: status === "unreadable" ? "unchecked" : status,
    line: entry.line,
  };
}
