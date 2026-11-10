import type { Gap } from "recognizer";

export type GapState = {
  gap: Gap;
  fixed: boolean;
  failure: string | null;
};

export type PreflightState = {
  state: "idle" | "running" | "gaps";
  gaps: GapState[];
};

export const NO_PREFLIGHT: PreflightState = { state: "idle", gaps: [] };

export type GapItem = {
  id: string;
  line: string;
  where: string;
  command: string;
  runnable: boolean;
  fixed: boolean;
  failure: string | null;
};

export type PreflightModel = {
  state: "running" | "gaps";
  card: { head: string; line: string };
  box: {
    title: string;
    left: number;
    total: number;
    count: string;
    items: GapItem[];
  } | null;
  button: { label: string; disabled: boolean };
};

const LANGUAGES: Record<string, string> = {
  python: "Python",
  typescript: "TypeScript",
  kotlin: "Kotlin",
  csharp: "C#",
  rust: "Rust",
};

export const RUNNING_TEXT = "Running pre-flight checks";

export const NOTHING_RAN_TEXT = "Nothing ran";

export const MISSING_TEXT =
  "Some tools the ticked sensors need are missing. Fix them below, then scan.";

export const BOX_TITLE = "Before this scan can run";

export const AGAIN_TEXT = "Check again and run";

function languageName(language: string): string {
  return (
    LANGUAGES[language] ??
    `${language.slice(0, 1).toUpperCase()}${language.slice(1)}`
  );
}

function whereText(
  gap: Gap,
  needs: string[],
  displayOf: (name: string) => string,
): string {
  const sensors = needs.map(displayOf).join(", ");

  if (gap.project === null) {
    return sensors;
  }

  const directory =
    gap.project.directory === "" ? "" : ` ${gap.project.directory}/`;

  return `${sensors} · ${languageName(gap.project.language)} project${directory}`;
}

export function runnableFix(gap: Gap): boolean {
  return gap.fix.kind === "repository" && gap.fix.command !== null;
}

export function buildPreflight(
  input: PreflightState,
  ticked: ReadonlySet<string>,
  displayOf: (name: string) => string,
): PreflightModel | null {
  if (input.state === "running") {
    return {
      state: "running",
      card: {
        head: RUNNING_TEXT,
        line: "Checking that every tool the ticked sensors need is in place.",
      },
      box: null,
      button: { label: RUNNING_TEXT, disabled: true },
    };
  }

  if (input.state === "idle") {
    return null;
  }

  const kept = input.gaps
    .map((one) => ({
      ...one,
      needs: one.gap.needs.filter((name) => ticked.has(name)),
    }))
    .filter((one) => one.needs.length > 0);

  if (kept.length === 0) {
    return null;
  }

  const left = kept.filter((one) => !one.fixed).length;

  return {
    state: "gaps",
    card: { head: NOTHING_RAN_TEXT, line: MISSING_TEXT },
    box: {
      title: BOX_TITLE,
      left,
      total: kept.length,
      count: `${left} of ${kept.length} left`,
      items: kept.map((one) => ({
        id: one.gap.id,
        line: one.gap.line,
        where: whereText(one.gap, one.needs, displayOf),
        command: one.gap.fix.text,
        runnable: runnableFix(one.gap),
        fixed: one.fixed,
        failure: one.failure,
      })),
    },
    button:
      left > 0
        ? { label: `${left} to fix before scanning`, disabled: true }
        : { label: AGAIN_TEXT, disabled: false },
  };
}
