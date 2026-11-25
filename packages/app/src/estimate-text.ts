export type PlannedWork = { unit: string; to_perform: number };

export type PartSpec = {
  key: string;
  name: string;
  runsTests: boolean;
  scoped: boolean;
  workVerb: string | null;
};

export type EstimatePart = {
  key: string;
  name: string;
  ms: number | null;
  basis: string | null;
};

export type PlannedIntent = {
  describe: boolean;
  analysis: boolean;
  sense: string[];
};

export type EstimateRequest = {
  intent: PlannedIntent;
  planWork: Record<string, number>;
  parts: PartSpec[];
  work: Record<string, PlannedWork>;
};

export type EstimateAnswer = {
  lastRun: string | null;
  describeRateMs: number | null;
  parts: EstimatePart[];
};

export type ScanEstimate = { text: string; title: string };

export const NO_ESTIMATE_TEXT =
  "No estimate until this repository has been scanned";

export function roundedTime(ms: number): string {
  const seconds = ms / 1000;

  if (seconds < 60) {
    return "under a minute";
  }

  const minutes = Math.round(seconds / 60);

  if (minutes < 60) {
    return `about ${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  return rest === 0 ? `about ${hours} h` : `about ${hours} h ${rest} min`;
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function shortTime(ms: number): string {
  const seconds = ms / 1000;

  if (seconds < 60) {
    return "<1 min";
  }

  const minutes = Math.round(seconds / 60);

  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  return rest === 0 ? `${hours} h` : `${hours} h ${rest} m`;
}

function missingText(part: EstimatePart): string {
  return `${part.name}: ${part.basis ?? "no estimate yet"}`;
}

export function estimateLine(parts: readonly EstimatePart[]): ScanEstimate {
  const known = parts.filter((one) => one.ms !== null);
  const missing = parts.filter((one) => one.ms === null);

  if (known.length === 0) {
    return { text: NO_ESTIMATE_TEXT, title: "" };
  }

  const total = known.reduce((sum, one) => sum + (one.ms as number), 0);
  const text =
    capitalised(roundedTime(total)) +
    (missing.length === 0
      ? ""
      : `, plus ${missing.map(missingText).join(", ")}`);
  const title = [
    ...known.map(
      (one) => `${one.name}: ${shortTime(one.ms as number)} (${one.basis})`,
    ),
    ...missing.map(missingText),
  ].join("\n");

  return { text, title };
}
