import { type Fix, type Gap } from "./gap.js";

export interface PreflightSensor {
  name: string;
  command: string[];
}

export interface EarlyInput {
  commit: string | null;
  sensors: PreflightSensor[];
}

const NO_COMMIT_FIX =
  "make the first commit (git add the files, then git commit)";

function outside(text: string, cwd = ""): Fix {
  return { text, command: null, cwd, env: {}, kind: "outside" };
}

export function earlyGaps(input: EarlyInput): Gap[] {
  const gaps: Gap[] = [];

  if (input.commit === null && input.sensors.length > 0) {
    gaps.push({
      id: "no-commit",
      line: "the folder has no git commit",
      needs: input.sensors.map((one) => one.name),
      project: null,
      fix: outside(NO_COMMIT_FIX),
    });
  }

  return gaps;
}
