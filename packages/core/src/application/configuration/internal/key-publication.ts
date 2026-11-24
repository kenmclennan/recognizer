import { POLICY_KEYS } from "../../../domain/configuration/policy-keys.js";
import {
  CORE_KEYS,
  type PublishedKeys,
  publish,
} from "../../../domain/configuration/published-keys.js";
import type { KeyOwners } from "../ports/key-owners.js";

export function publishedFor(
  subject: "config" | "policy",
  owners: KeyOwners,
): PublishedKeys {
  if (subject === "policy") {
    return publish([POLICY_KEYS], "policy");
  }

  const read = owners.schemas();
  const published = publish([CORE_KEYS, read.schema], "config");

  return read.notAnswering.length === 0
    ? published
    : { ...published, notAnswering: read.notAnswering.join("; ") };
}
