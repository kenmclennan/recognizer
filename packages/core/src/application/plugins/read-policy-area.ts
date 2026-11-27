import {
  commandFix,
  quoted,
  textFix,
  withRepository,
} from "../../domain/plugins/doctor-commands.js";
import type {
  Found,
  SetupProblem,
} from "../../domain/plugins/doctor-report.js";
import { policyProblems } from "../../domain/plugins/policy-problems.js";
import { PolicyRule } from "../../domain/policy-rule.js";
import {
  isRetiredPolicyKeyMessage,
  retiredPolicyKeysIn,
} from "../configuration/policy-reading.js";
import type { RepositoryChecks } from "./ports/repository-checks.js";

const POLICY_FILE = ".recognizer/policy.yaml";

interface Target {
  repository: string;
  named: boolean;
}

function policyCommand(target: Target, arguments_: string): string {
  return withRepository(target, `recognizer policy ${arguments_}`);
}

function entryFix(target: Target, glob: string): SetupProblem["fix"] {
  return commandFix(policyCommand(target, `--unset entry ${quoted(glob)}`));
}

function invalidFix(): SetupProblem["fix"] {
  return textFix(
    `recognizer policy cannot repair a structurally invalid policy: correct ${POLICY_FILE} by hand, then run recognizer policy --list to confirm it reads`,
  );
}

export function readPolicyArea(
  repository: RepositoryChecks,
  root: string,
  named: boolean,
  languages: readonly string[],
): Found[] {
  const target = { repository: root, named };
  const facts = repository.policyFacts(root);

  if (facts.kind === "absent") {
    return [];
  }

  const retired = retiredPolicyKeysIn(facts.keys);
  const found: Found[] = [];

  if (retired.length > 0) {
    found.push({
      code: "policy-retired",
      subject: POLICY_FILE,
      line: `the policy uses retired keys: ${retired.join(", ")}`,
      fix: commandFix(policyCommand(target, "--migrate")),
    });
  }

  if (!facts.parsed.ok) {
    return [
      ...found,
      ...facts.parsed.messages
        .filter((line) => !isRetiredPolicyKeyMessage(line))
        .map((line) => ({
          code: "policy-invalid" as const,
          subject: POLICY_FILE,
          line,
          fix: invalidFix(),
        })),
    ];
  }

  const policy = facts.parsed.rules;

  if (
    (PolicyRule.entries(policy).length === 0 &&
      PolicyRule.forbids(policy).length === 0) ||
    languages.length === 0
  ) {
    return [];
  }

  const state = repository.scansState(root, languages);
  const where = languages.join(", ");
  const scan = `recognizer scan${named ? ` ${quoted(root)}` : ""}`;

  if (state.state === "missing") {
    return [
      {
        code: "scan-missing",
        subject: where,
        line: `no scan of ${where}: the policy was not compared with the code`,
        fix: commandFix(scan),
      },
    ];
  }

  if (state.state === "stale" && state.reason === "uncommitted") {
    const count = state.paths.length;
    const shown = state.paths.slice(0, 3).join(", ");
    const more = count > 3 ? ` and ${count - 3} more` : "";

    return [
      {
        code: "scan-stale",
        subject: where,
        line: `the scan of ${where} was not used: the working tree has ${count} uncommitted ${count === 1 ? "change" : "changes"} outside .recognizer/ (${shown}${more}), so the policy was not compared with the code`,
        fix: textFix(`commit, ignore or stash these changes, then run ${scan}`),
      },
    ];
  }

  if (state.state === "stale") {
    return [
      {
        code: "scan-stale",
        subject: where,
        line: `the scan of ${where} is out of date with the working tree: the policy was not compared with the code`,
        fix: commandFix(scan),
      },
    ];
  }

  return policyProblems(state.repository, policy).map((problem) =>
    problem.kind === "entry"
      ? {
          code: "policy-entry" as const,
          subject: problem.subject,
          line: problem.text,
          fix: entryFix(target, problem.subject),
        }
      : {
          code: "policy-forbid" as const,
          subject: problem.subject,
          line: problem.text,
          fix: textFix(
            `correct the glob ${problem.subject} in ${POLICY_FILE}, or remove it from its forbid rule`,
          ),
        },
  );
}
