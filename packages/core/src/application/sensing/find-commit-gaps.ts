import { type Gap, NO_COMMIT_FIX, outside } from "../../domain/gap.js";

export interface CommitGapsInput {
  commit: string | null;
  sensors: { name: string; command: string[] }[];
}

export function findCommitGaps(input: CommitGapsInput): Gap[] {
  return input.commit === null && input.sensors.length > 0
    ? [
        {
          id: "no-commit",
          line: "the folder has no git commit",
          needs: input.sensors.map((one) => one.name),
          fix: outside(NO_COMMIT_FIX),
        },
      ]
    : [];
}
