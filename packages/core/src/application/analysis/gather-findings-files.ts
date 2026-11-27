import type { FindingsRepository } from "../../domain/findings-repository.js";
import type { Repository } from "../../domain/repository.js";
import type { Say } from "../shared/ports/process.js";
import {
  freshnessFor,
  type ReadOutcome,
  readFindingsFiles,
} from "./read-findings-files.js";
import type { TestsHashPorts } from "./tests-hash.js";

export interface FindingsFilesPorts extends TestsHashPorts {
  findings: Pick<FindingsRepository, "readAll">;
}

function sayOutcome(say: Say, outcome: ReadOutcome): void {
  if (outcome.status === "unregistered") {
    say("stderr", `ignored unregistered ${outcome.name}\n`);
  } else if (outcome.status === "invalid") {
    say("stderr", `invalid ${outcome.name}: ${outcome.reason}\n`);
  } else if (!outcome.valid) {
    say(
      "stderr",
      outcome.reported
        ? `stale ${outcome.name} (reported at ${outcome.document.commit.slice(0, 7)})\n`
        : `stale ${outcome.name}\n`,
    );
  } else if (outcome.hidden.length > 0) {
    say(
      "stderr",
      `out of date ${outcome.name}: ${outcome.hidden.length} findings\n`,
    );
  }
}

export function gatherFindingsFiles(
  ports: FindingsFilesPorts,
  say: Say,
  root: string,
  repository: Repository,
  scope: { skip: string[]; allowed: string[] },
): ReadOutcome[] {
  const outcomes = readFindingsFiles(
    ports.findings.readAll(root),
    freshnessFor(ports, root, repository),
    scope.skip,
    scope.allowed,
  );

  for (const outcome of outcomes) {
    sayOutcome(say, outcome);
  }

  return outcomes;
}
