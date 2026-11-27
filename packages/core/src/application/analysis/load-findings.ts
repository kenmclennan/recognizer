import { carryMeasured } from "../../domain/analysis/duplication/carry.js";
import { LanguageBehaviour } from "../../domain/analysis/language-behaviour.js";
import { scansCommit } from "../../domain/analysis/scans-commit.js";
import { storedStructureReusable } from "../../domain/analysis/stored-structure.js";
import { unknownFilesOf } from "../../domain/analysis/unknown-files.js";
import type { ConfigRepository } from "../../domain/config-repository.js";
import type { FindingsRepository } from "../../domain/findings-repository.js";
import type { PolicyRepository } from "../../domain/policy-repository.js";
import type { Repository } from "../../domain/repository.js";
import type { SensorFindings } from "../../domain/sensor-findings.js";
import type { Say } from "../shared/ports/process.js";
import type { RepositoryFiles } from "../shared/ports/repository-files.js";
import { gatherFindingsFiles } from "./gather-findings-files.js";
import type { Digest } from "./ports/digest.js";
import type { PublishedLanguages } from "./ports/published-languages.js";
import type { SourceFiles } from "./ports/source-files.js";
import type { TestReports } from "./ports/test-reports.js";
import { senseStructure } from "./sense-structure.js";

export interface LoadFindingsPorts {
  config: Pick<ConfigRepository, "structureSettings" | "sensorNames">;
  findings: Pick<FindingsRepository, "readStructure" | "save" | "readAll">;
  policy: Pick<PolicyRepository, "rules">;
  source: SourceFiles;
  repositoryFiles: RepositoryFiles;
  digest: Digest;
  testReports: TestReports;
  languages: PublishedLanguages;
}

export function loadFindings(
  ports: LoadFindingsPorts,
  say: Say,
  root: string,
  repository: Repository,
): SensorFindings[] {
  const settings = ports.config.structureSettings(root);
  const { commit, modified } = scansCommit(repository);
  const documents: SensorFindings[] = [];
  const behaviour = new LanguageBehaviour(ports.languages.rules());

  if (settings !== "off") {
    const context = { commit: commit ?? "", modified };
    const compute = () =>
      carryMeasured(
        ports.findings.readStructure(root),
        senseStructure(
          repository,
          ports.policy.rules(root),
          settings,
          context,
          behaviour,
        ).document,
        settings,
      );

    if (commit === null) {
      documents.push(compute());
    } else {
      const held = ports.findings.readStructure(root);
      const stored =
        held !== null &&
        storedStructureReusable(held, {
          commit,
          settings,
          unknownFiles: unknownFilesOf(repository, behaviour),
        })
          ? held
          : null;

      if (stored !== null) {
        documents.push(stored);
      } else {
        const fresh = compute();

        try {
          ports.findings.save(root, fresh);
        } catch {
          say("stderr", "could not write structure findings\n");
        }

        documents.push(fresh);
      }
    }
  }

  for (const outcome of gatherFindingsFiles(ports, say, root, repository, {
    skip: ["structure"],
    allowed: ports.config.sensorNames(root),
  })) {
    if (outcome.status === "read") {
      documents.push(outcome.document);
    }
  }

  return documents;
}
