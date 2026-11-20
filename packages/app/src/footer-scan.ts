export type FileChange = {
  path: string;
  kind: "modified" | "added" | "deleted";
};

export type Changes = {
  files: FileChange[];
  moved: { branch: string | null; commit: string } | null;
};

export type ScanOrigin = { branch: string | null; commit: string | null };

export type ScanState = {
  origin: ScanOrigin;
  scannedAt: number;
  changes: Changes;
  scanning: string | null;
};

export const NO_CHANGES: Changes = { files: [], moved: null };

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function ageText(scannedAt: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - scannedAt) / 60000);

  if (minutes < 1) {
    return "just now";
  }

  if (minutes < 60) {
    return `${plural(minutes, "minute")} ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${plural(hours, "hour")} ago`;
  }

  return `${plural(Math.floor(hours / 24), "day")} ago`;
}
