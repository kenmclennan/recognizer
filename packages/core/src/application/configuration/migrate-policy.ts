import { policyNotYamlMessage } from "../../domain/configuration/policy-document.js";
import {
  isPlainObject,
  literalPaths,
  migratedRules,
  readRetired,
} from "../../domain/configuration/policy-migration.js";
import { retiredPolicyKeysIn } from "../../domain/configuration/retired-keys.js";
import { InvalidRequest } from "../../domain/invalid-request.js";
import type { PolicyRepository } from "../../domain/policy-repository.js";
import { introducedProblems, MISSING_POLICY } from "./edit-key.js";
import type { KeyedText, Rewrite } from "./ports/keyed-text.js";

export interface PolicyEditPorts {
  policy: Pick<PolicyRepository, "text" | "saveText" | "problems">;
  keyedText: KeyedText;
}

export type MigratePolicyOutcome =
  | { status: "migrated"; changes: string[] }
  | { status: "unchanged" }
  | { status: "missing"; reason: string }
  | { status: "refused"; messages: string[] };

export function migratePolicy(
  ports: PolicyEditPorts,
  { root }: { root: string },
): MigratePolicyOutcome {
  const current = ports.policy.text(root);

  if (!current.present) {
    return { status: "missing", reason: MISSING_POLICY };
  }

  const read = ports.keyedText.plain(current.text);

  if ("invalid" in read) {
    return {
      status: "refused",
      messages: [policyNotYamlMessage(read.invalid)],
    };
  }

  const raw = read.value;

  if (!isPlainObject(raw)) {
    return { status: "unchanged" };
  }

  const present = retiredPolicyKeysIn(Object.keys(raw));

  if (present.length === 0) {
    return { status: "unchanged" };
  }

  const retired = readRetired(raw);

  if (Array.isArray(retired)) {
    return { status: "refused", messages: retired };
  }

  const rules = migratedRules(retired);
  const paths = literalPaths(retired);

  const rewrites: Rewrite[] = [
    { op: "fold-into-list", from: "components", list: "entry", items: paths },
    { op: "remove-key", name: "levels" },
    { op: "remove-key", name: "uses" },
    { op: "remove-key", name: "foreign" },
    ...(rules.length > 0
      ? [{ op: "append-rules", name: "forbid", rules } satisfies Rewrite]
      : []),
    { op: "keep-header" },
  ];

  ports.policy.saveText(root, ports.keyedText.rewrite(current.text, rewrites));

  return {
    status: "migrated",
    changes: [
      `removed ${present.join(", ")}`,
      ...(paths.length > 0 ? [`entry: ${paths.join(", ")}`] : []),
      ...rules.map(
        (rule) => `forbid: ${rule.from.join(", ")} -> ${rule.to.join(", ")}`,
      ),
    ],
  };
}

export type AddForbidOutcome =
  | { status: "added" }
  | { status: "duplicate" }
  | { status: "invalid-yaml"; message: string }
  | { status: "refused"; reason: string };

function sameGlobs(value: unknown, globs: string[]): boolean {
  const items = Array.isArray(value) ? value : [value];

  return (
    items.length === globs.length &&
    items.every((item, at) => item === globs[at])
  );
}

export function addForbid(
  ports: PolicyEditPorts,
  { root, from, to }: { root: string; from: string[]; to: string[] },
): AddForbidOutcome {
  if (
    from.length === 0 ||
    to.length === 0 ||
    [...from, ...to].some((glob) => glob.trim() === "")
  ) {
    throw new InvalidRequest(["a forbid rule needs a from glob and a to glob"]);
  }

  const original = ports.policy.text(root).text;
  const read = ports.keyedText.plain(original);

  if ("invalid" in read) {
    return { status: "invalid-yaml", message: read.invalid };
  }

  const present = read.value as { forbid?: unknown } | null;
  const duplicate =
    Array.isArray(present?.forbid) &&
    present.forbid.some(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        sameGlobs((entry as { from?: unknown }).from, from) &&
        sameGlobs((entry as { to?: unknown }).to, to),
    );

  if (duplicate) {
    return { status: "duplicate" };
  }

  const text = ports.keyedText.rewrite(original, [
    { op: "append-rules", name: "forbid", rules: [{ from, to }] },
  ]);
  const invalid = introducedProblems(ports.policy, original, text);

  if (invalid !== null) {
    return { status: "refused", reason: invalid };
  }

  ports.policy.saveText(root, text);

  return { status: "added" };
}
