import type { NameStatusEntry } from "@recognizer/core";

const STATUSES = new Set(["A", "M", "D", "T"]);

export function parseNameStatus(stdout: string): NameStatusEntry[] {
  const fields = stdout.split("\0");
  const entries: NameStatusEntry[] = [];
  let index = 0;

  while (index < fields.length) {
    const status = fields[index] as string;

    index += 1;

    if (status.startsWith("R")) {
      const from = fields[index];
      const path = fields[index + 1];

      index += 2;

      if (from !== undefined && path !== undefined) {
        entries.push({ status: "R", path, from });
      }

      continue;
    }

    const path = fields[index];

    index += 1;

    if (path === undefined) {
      break;
    }

    if (STATUSES.has(status)) {
      entries.push({ status: status as "A" | "M" | "D" | "T", path });
    }
  }

  return entries;
}
