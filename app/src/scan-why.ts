import type { Diagnosis } from "recognizer";

export type ScanWhy = {
  segments: { text: string; code: boolean }[];
  copy: string | null;
  log: boolean;
};

function sentence(line: string): string {
  return /[.!?]$/.test(line) ? line : `${line}.`;
}

function split(text: string, chips: string[]): ScanWhy["segments"] {
  const found = chips
    .map((chip) => ({ chip, at: text.indexOf(chip) }))
    .filter(({ at }) => at >= 0)
    .sort((a, b) => a.at - b.at);
  const segments: ScanWhy["segments"] = [];
  let cursor = 0;

  for (const { chip, at } of found) {
    if (at < cursor) {
      continue;
    }

    if (at > cursor) {
      segments.push({ text: text.slice(cursor, at), code: false });
    }

    segments.push({ text: chip, code: true });
    cursor = at + chip.length;
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), code: false });
  }

  return segments;
}

export function whyOf(diagnosis: Diagnosis): ScanWhy {
  const chips = [
    ...(diagnosis.fix === undefined ? [] : [diagnosis.fix]),
    ...(diagnosis.failing?.names[0] === undefined
      ? []
      : [diagnosis.failing.names[0]]),
  ];

  return {
    segments: split(sentence(diagnosis.line), chips),
    copy: diagnosis.fix ?? null,
    log:
      diagnosis.code === "tests-failed" ||
      (diagnosis.code === "coverage-unavailable" &&
        diagnosis.fix === undefined),
  };
}
