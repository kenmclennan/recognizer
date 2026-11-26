import type { SettingEdit, Settings } from "./settings-modal-port";

export type StoredSettings = {
  editor: string;
  describing: {
    model: string | null;
    batchSize: number;
    confirmAboveUsd: number;
  };
  setup: { model: string };
};

export function toValues(stored: StoredSettings): Settings {
  return {
    values: {
      editor: stored.editor,
      ...(stored.describing.model === null
        ? {}
        : { "describing.model": stored.describing.model }),
      "describing.batch_size": String(stored.describing.batchSize),
      "describing.confirm_above_usd": String(stored.describing.confirmAboveUsd),
      "setup.model": stored.setup.model,
    },
  };
}

function numberFor(key: string, value: SettingEdit["value"]): number {
  const number = typeof value === "number" ? value : Number(value);

  if (typeof value === "boolean" || !Number.isFinite(number)) {
    throw new Error(`${key} must be a number`);
  }

  return number;
}

function textFor(key: string, value: SettingEdit["value"]): string {
  if (typeof value !== "string") {
    throw new Error(`${key} must be text`);
  }

  return value;
}

export function applyEdits(
  stored: StoredSettings,
  edits: SettingEdit[],
): StoredSettings {
  const next: StoredSettings = {
    editor: stored.editor,
    describing: { ...stored.describing },
    setup: { ...stored.setup },
  };

  for (const { key, value } of edits) {
    switch (key) {
      case "editor":
        next.editor = textFor(key, value);
        break;
      case "describing.model":
        next.describing.model = textFor(key, value);
        break;
      case "describing.batch_size":
        next.describing.batchSize = numberFor(key, value);
        break;
      case "describing.confirm_above_usd":
        next.describing.confirmAboveUsd = numberFor(key, value);
        break;
      case "setup.model":
        next.setup.model = textFor(key, value);
        break;
      default:
        throw new Error(`${key} is not a machine setting`);
    }
  }

  return next;
}
