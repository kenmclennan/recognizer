import { PolicyRule } from "../policy-rule.js";
import { isPlainObject, readGlobs } from "./policy-migration.js";
import { RETIRED_POLICY_KEYS, retiredPolicyKeysIn } from "./retired-keys.js";

export type PolicyRead =
  | { ok: true; rules: PolicyRule[] }
  | { ok: false; messages: string[] };

const SIDES: readonly string[] = "from to".split(" ");

const ALLOWED_POLICY_KEYS: readonly string[] = ["forbid", "ignore", "entry"];

export function policyNotYamlMessage(detail: string): string {
  return `policy is not valid YAML: ${detail}`;
}

export function retiredPolicyKeyMessage(key: string): string {
  return `policy: "${key}" is retired; run recognizer doctor for the migration`;
}

export function isRetiredPolicyKeyMessage(line: string): boolean {
  return RETIRED_POLICY_KEYS.some(
    (key) => line === retiredPolicyKeyMessage(key),
  );
}

function readForbidEntry(entry: unknown, errors: string[]): PolicyRule | null {
  if (isPlainObject(entry)) {
    return readForbidMapping(entry, errors);
  }

  if (typeof entry !== "string") {
    errors.push("forbid: every entry must be a string or a from/to mapping");

    return null;
  }

  const at = entry.indexOf(" -> ");

  if (at < 0) {
    errors.push(`forbid: "${entry}" must look like "<from-glob> -> <to-glob>"`);

    return null;
  }

  const from = entry.slice(0, at).trim();
  const to = entry.slice(at + 4).trim();

  if (from === "" || to === "") {
    errors.push(`forbid: "${entry}" has an empty glob`);

    return null;
  }

  return PolicyRule.of({
    type: "forbid",
    pattern: entry,
    from: [from],
    to: [to],
  });
}

function readForbidMapping(
  entry: Record<string, unknown>,
  errors: string[],
): PolicyRule | null {
  const shown = JSON.stringify(entry);
  const keys = Object.keys(entry);

  if (keys.length !== 2 || !SIDES.every((side) => keys.includes(side))) {
    errors.push(
      `forbid: ${shown} must have exactly the keys "${SIDES.join(`" and "`)}"`,
    );

    return null;
  }

  const sides: string[][] = [];

  for (const side of SIDES) {
    const value = entry[side];

    if (Array.isArray(value) && value.length === 0) {
      errors.push(`forbid: ${shown} has an empty "${side}" list`);

      return null;
    }

    const before = errors.length;
    const globs = readGlobs(value, `forbid ${shown} ${side}`, errors);

    if (errors.length > before) {
      return null;
    }

    sides.push(globs);
  }

  const [from, to] = sides as [string[], string[]];

  return PolicyRule.of({
    type: "forbid",
    pattern: `${from.join(", ")} -> ${to.join(", ")}`,
    from,
    to,
  });
}

function readGlobSection(
  value: unknown,
  name: string,
  errors: string[],
): string[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    errors.push(`${name}: must be a list of globs`);

    return [];
  }

  return readGlobs(value, name, errors);
}

export function readPolicyDocument(document: unknown): PolicyRead {
  if (!isPlainObject(document)) {
    return { ok: false, messages: ["policy must be a YAML mapping"] };
  }

  const errors: string[] = [];
  const retired = retiredPolicyKeysIn(Object.keys(document));

  for (const key of Object.keys(document)) {
    if (retired.includes(key)) {
      errors.push(retiredPolicyKeyMessage(key));
    } else if (!ALLOWED_POLICY_KEYS.includes(key)) {
      errors.push(`policy: unknown key "${key}"`);
    }
  }

  const forbid: PolicyRule[] = [];

  if (document.forbid !== undefined) {
    if (!Array.isArray(document.forbid)) {
      errors.push("forbid: must be a list");
    } else {
      for (const entry of document.forbid) {
        const rule = readForbidEntry(entry, errors);

        if (rule) {
          forbid.push(rule);
        }
      }
    }
  }

  const ignore = readGlobSection(document.ignore, "ignore", errors);
  const entry = readGlobSection(document.entry, "entry", errors);

  if (errors.length > 0) {
    return { ok: false, messages: errors };
  }

  return {
    ok: true,
    rules: [
      ...forbid,
      ...ignore.map(
        (glob): PolicyRule => PolicyRule.of({ type: "ignore", glob }),
      ),
      ...entry.map(
        (glob): PolicyRule => PolicyRule.of({ type: "entry", glob }),
      ),
    ],
  };
}
