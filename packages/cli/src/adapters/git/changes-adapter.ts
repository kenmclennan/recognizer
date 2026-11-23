import type {
  ChangeMarks,
  Changes,
  Repository,
  ViewChange,
} from "@recognizer/core";
import { changeMarks, parseNameStatus } from "../../change-marks.js";
import type { Io } from "../../cli.js";

export class ChangesAdapter implements Changes {
  constructor(private readonly io: Io) {}

  marks(
    root: string,
    change: ViewChange,
    repository: Repository,
    base: Repository | null,
  ): ChangeMarks | null {
    const result = this.io.run("git", [
      "-C",
      root,
      "diff",
      "-M",
      "--name-status",
      "-z",
      `${change.base}...${change.head}`,
    ]);

    if (!result.started || result.status !== 0) {
      return null;
    }

    return changeMarks(
      parseNameStatus(result.stdout).changes,
      repository,
      base,
    );
  }
}
