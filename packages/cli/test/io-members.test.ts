import { describe, expect, it } from "vitest";
import { nodeIo } from "../src/cli.js";
import { FILE_MEMBERS_COVERED } from "./adapter-contract/io-files-contract.js";
import {
  IO_FILE_MEMBERS,
  IO_OTHER_MEMBERS,
  IO_PROCESS_MEMBERS,
  IO_TIMER_MEMBERS,
} from "./adapter-contract/io-members.js";
import { checkIoMembers } from "./adapter-contract/io-members-check.js";
import { PROCESS_MEMBERS_COVERED } from "./adapter-contract/io-processes-contract.js";
import { TIMER_MEMBERS_COVERED } from "./adapter-contract/io-timers-contract.js";

describe("Io members", () => {
  it("reports an unlisted key, a stale name and an uncovered member and passes the others", () => {
    const report = checkIoMembers({
      keys: ["a", "b", "c", "d", "e", "f", "extra"],
      files: ["a", "b"],
      timers: ["c"],
      processes: ["d", "e"],
      other: ["f", "gone"],
      filesCovered: new Set(["a"]),
      timersCovered: new Set(["c"]),
      processesCovered: new Set(["d"]),
    });

    expect(report).toEqual({
      unclassified: ["extra"],
      stale: ["gone"],
      uncovered: ["b", "e"],
    });
  });

  it("the real Io is fully classified and every file, timer and process member has a case", () => {
    const keys = Object.keys(nodeIo());

    expect(keys).toHaveLength(31);
    expect(IO_FILE_MEMBERS).toHaveLength(14);
    expect(IO_TIMER_MEMBERS).toHaveLength(4);
    expect(IO_PROCESS_MEMBERS).toHaveLength(4);
    expect(IO_OTHER_MEMBERS).toHaveLength(9);
    expect(
      checkIoMembers({
        keys,
        files: IO_FILE_MEMBERS,
        timers: IO_TIMER_MEMBERS,
        processes: IO_PROCESS_MEMBERS,
        other: IO_OTHER_MEMBERS,
        filesCovered: FILE_MEMBERS_COVERED,
        timersCovered: TIMER_MEMBERS_COVERED,
        processesCovered: PROCESS_MEMBERS_COVERED,
      }),
    ).toEqual({ unclassified: [], stale: [], uncovered: [] });
  });
});
