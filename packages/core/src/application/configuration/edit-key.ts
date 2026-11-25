import type { ConfigRepository } from "../../domain/config-repository.js";
import type { PublishedKeys } from "../../domain/configuration/published-keys.js";
import type { PolicyRepository } from "../../domain/policy-repository.js";
import { publishedFor } from "./internal/key-publication.js";
import {
  addKeySection,
  addKeyValue,
  type EditOutcome,
  listKeyed,
  readKeyValue,
  removeKeySection,
  setKeyValue,
  unsetKeyValue,
} from "./key-edits.js";
import type { KeyOwners } from "./ports/key-owners.js";
import type { KeyedText } from "./ports/keyed-text.js";

export type KeySubject = "config" | "policy";

export type KeyVerb =
  | "set"
  | "add"
  | "get"
  | "list"
  | "unset"
  | "remove-section"
  | "add-section";

export interface KeyEditPorts {
  config: Pick<ConfigRepository, "text" | "saveText">;
  policy: Pick<PolicyRepository, "text" | "saveText" | "problems">;
  keyedText: KeyedText;
  keyOwners: KeyOwners;
}

export interface EditKeyRequest {
  subject: KeySubject;
  root: string;
  verb: KeyVerb;
  key: string;
  value?: string;
}

export type EditKeyOutcome =
  | { status: "ok"; lines: string[] }
  | { status: "absent" }
  | { status: "refused"; key: string; reason: string; suffix: string }
  | { status: "missing"; reason: string }
  | { status: "skipped"; lines: string[]; paths: string[]; why: string };

export const MISSING_POLICY = "there is no policy at .recognizer/policy.yaml";

export function refusalSuffix(
  published: PublishedKeys,
  reason: string,
): string {
  return published.notAnswering !== null &&
    /^no such key|is not a valid/.test(reason)
    ? `; ${published.notAnswering}`
    : "";
}

export function editText(
  keyed: KeyedText,
  published: PublishedKeys,
  verb: KeyVerb,
  text: string,
  key: string,
  value: string | undefined,
): EditOutcome {
  switch (verb) {
    case "set":
      return setKeyValue(keyed, text, published, key, value as string);
    case "add":
      return addKeyValue(keyed, text, published, key, value as string);
    case "unset":
      return unsetKeyValue(keyed, text, published, key, value);
    case "remove-section":
      return removeKeySection(keyed, text, published, key);
    default:
      return addKeySection(keyed, text, published, key);
  }
}

export function introducedProblems(
  policy: Pick<PolicyRepository, "problems">,
  original: string,
  text: string,
): string | null {
  const before = new Set(policy.problems(original));
  const added = policy.problems(text).filter((message) => !before.has(message));

  return added.length === 0 ? null : added.join("; ");
}

export function editKey(
  ports: KeyEditPorts,
  { subject, root, verb, key, value }: EditKeyRequest,
): EditKeyOutcome {
  const repository = subject === "config" ? ports.config : ports.policy;
  const published = publishedFor(subject, ports.keyOwners, root);
  const current = repository.text(root);
  const refused = (reason: string): EditKeyOutcome => ({
    status: "refused",
    key,
    reason,
    suffix: refusalSuffix(published, reason),
  });

  if (
    !current.present &&
    subject === "policy" &&
    verb !== "set" &&
    verb !== "add" &&
    verb !== "add-section"
  ) {
    return { status: "missing", reason: MISSING_POLICY };
  }

  if (verb === "list") {
    const listing = listKeyed(ports.keyedText, current.text, published);

    return listing.skipped.length === 0
      ? { status: "ok", lines: listing.lines }
      : {
          status: "skipped",
          lines: listing.lines,
          paths: listing.skipped,
          why:
            published.notAnswering === null
              ? ""
              : `: ${published.notAnswering}`,
        };
  }

  if (verb === "get") {
    const outcome = readKeyValue(ports.keyedText, current.text, published, key);

    if (outcome.status === "refused") {
      return refused(outcome.reason);
    }

    return outcome.status === "absent"
      ? { status: "absent" }
      : { status: "ok", lines: outcome.lines };
  }

  const outcome = editText(
    ports.keyedText,
    published,
    verb,
    current.text,
    key,
    value,
  );

  if (outcome.status === "refused") {
    return refused(outcome.reason);
  }

  if (outcome.status === "absent") {
    return { status: "absent" };
  }

  if (subject === "policy" && outcome.text !== current.text) {
    const invalid = introducedProblems(
      ports.policy,
      current.text,
      outcome.text,
    );

    if (invalid !== null) {
      return refused(invalid);
    }
  }

  if (outcome.text !== current.text || !current.present) {
    repository.saveText(root, outcome.text);
  }

  return { status: "ok", lines: [] };
}
