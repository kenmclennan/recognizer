export interface Fix {
  text: string;
  command: string[] | null;
  cwd: string;
  env: Record<string, string>;
  kind: "repository" | "outside";
}

export interface Gap {
  id: string;
  line: string;
  needs: string[];
  fix: Fix;
}

function isFix(value: unknown): value is Fix {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const fix = value as Record<string, unknown>;

  return (
    typeof fix.text === "string" &&
    (fix.command === null ||
      (Array.isArray(fix.command) &&
        fix.command.every((item) => typeof item === "string"))) &&
    typeof fix.cwd === "string" &&
    typeof fix.env === "object" &&
    fix.env !== null &&
    (fix.kind === "repository" || fix.kind === "outside")
  );
}

export function isGap(value: unknown): value is Gap {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const gap = value as Record<string, unknown>;

  return (
    typeof gap.id === "string" &&
    typeof gap.line === "string" &&
    Array.isArray(gap.needs) &&
    gap.needs.length > 0 &&
    gap.needs.every((item) => typeof item === "string") &&
    isFix(gap.fix)
  );
}

export function gapText(gap: Gap): string {
  return `${gap.line} (${gap.needs.join(", ")}): ${gap.fix.text}`;
}

export function preflightLine(
  detail: { state: "run" } | { state: "ok" } | { state: "gaps"; gaps: Gap[] },
): string {
  return `${JSON.stringify({ event: "preflight", ...detail })}\n`;
}
