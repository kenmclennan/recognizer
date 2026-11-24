import { InvalidRequest } from "../../domain/invalid-request.js";
import { editText, type KeyEditPorts, refusalSuffix } from "./edit-key.js";
import { publishedFor } from "./internal/key-publication.js";

export interface ConfigEdit {
  op: "set" | "unset" | "add-section";
  key: string;
  value?: string | null;
}

export interface WriteConfigEditsRequest {
  root: string;
  edits: ConfigEdit[];
  baseHash: string;
}

export type WriteConfigEditsOutcome =
  | { status: "written"; text: string }
  | { status: "refused"; key: string | null; reason: string }
  | { status: "changed"; reason: string };

export const CONFIG_CHANGED = "the config changed since it was read";

function keyOk(key: string): boolean {
  return (
    key !== "" &&
    !key.startsWith("-") &&
    key.split(".").every((part) => part !== "" && part !== "..") &&
    /^[A-Za-z0-9._<>-]+$/.test(key)
  );
}

function checkEdits(edits: ConfigEdit[]): WriteConfigEditsOutcome | null {
  for (const edit of edits) {
    if (!keyOk(edit.key)) {
      return {
        status: "refused",
        key: edit.key,
        reason: `${edit.key} is not a config key`,
      };
    }

    if (edit.op === "set" && (edit.value ?? null) === null) {
      return {
        status: "refused",
        key: edit.key,
        reason: "a set needs a value",
      };
    }
  }

  return null;
}

export function writeConfigEdits(
  ports: KeyEditPorts,
  { root, edits, baseHash }: WriteConfigEditsRequest,
): WriteConfigEditsOutcome {
  const invalid = checkEdits(edits);

  if (invalid !== null) {
    return invalid;
  }

  const current = ports.config.text(root);

  if (current.hash !== baseHash) {
    return { status: "changed", reason: CONFIG_CHANGED };
  }

  try {
    const published = publishedFor("config", ports.keyOwners);
    let text = current.text;

    for (const edit of edits) {
      const outcome = editText(
        ports.keyedText,
        published,
        edit.op === "add-section" ? "add-section" : edit.op,
        text,
        edit.key,
        edit.value ?? undefined,
      );

      if (outcome.status === "refused") {
        return {
          status: "refused",
          key: edit.key,
          reason: `${outcome.reason}${refusalSuffix(published, outcome.reason)}`,
        };
      }

      if (outcome.status === "ok") {
        text = outcome.text;
      }
    }

    ports.config.saveText(root, text);

    return { status: "written", text };
  } catch (error) {
    if (error instanceof InvalidRequest) {
      return {
        status: "refused",
        key: null,
        reason: error.messages[0] ?? error.message,
      };
    }

    throw error;
  }
}
