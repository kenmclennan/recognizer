export type PreflightGap = {
  id: string;
  line: string;
  needs: string[];
};

export type PreflightState = {
  state: "idle" | "running" | "gaps";
  gaps: PreflightGap[];
};

export const NO_PREFLIGHT: PreflightState = { state: "idle", gaps: [] };

export type GapItem = {
  id: string;
  line: string;
  where: string;
};

export type HelpLine = {
  sensor: string;
  text: string;
  command: string;
};

export type PreflightModel = {
  state: "running" | "gaps";
  card: { head: string; line: string };
  box: {
    title: string;
    items: GapItem[];
    help: HelpLine[];
  } | null;
  button: { label: string; disabled: boolean };
};

export const RUNNING_TEXT = "Running pre-flight checks";

export const NOTHING_RAN_TEXT = "Nothing ran";

export const MISSING_TEXT =
  "Some tools the ticked sensors need are missing. Set them up as below, then scan again.";

export const BOX_TITLE = "Before this scan can run";

export const AGAIN_TEXT = "Check again and run";

export const HELP_TEXT = "To set this up with an agent:";

function sensorOf(
  gap: PreflightGap,
  sensors: ReadonlySet<string>,
): string | null {
  const [only] = gap.needs;

  if (gap.needs.length !== 1 || only === undefined) {
    return null;
  }

  return sensors.has(only) && gap.id.startsWith(`${only}:`) ? only : null;
}

export function buildPreflight(
  input: PreflightState,
  ticked: ReadonlySet<string>,
  displayOf: (name: string) => string,
  sensors: ReadonlySet<string>,
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
    .map((gap) => ({
      gap,
      needs: gap.needs.filter((name) => ticked.has(name)),
    }))
    .filter((one) => one.needs.length > 0);

  if (kept.length === 0) {
    return null;
  }

  const named = kept
    .map((one) => sensorOf(one.gap, sensors))
    .filter((name): name is string => name !== null);

  return {
    state: "gaps",
    card: { head: NOTHING_RAN_TEXT, line: MISSING_TEXT },
    box: {
      title: BOX_TITLE,
      items: kept.map((one) => ({
        id: one.gap.id,
        line: one.gap.line,
        where: one.needs.map(displayOf).join(", "),
      })),
      help: [...new Set(named)].map((sensor) => ({
        sensor,
        text: HELP_TEXT,
        command: `recognizer help sensors ${sensor}`,
      })),
    },
    button: { label: AGAIN_TEXT, disabled: false },
  };
}
