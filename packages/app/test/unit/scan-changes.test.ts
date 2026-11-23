import { describe, expect, it } from "vitest";
import {
  type Changes,
  NO_CHANGES,
  type ScanState,
} from "../../src/footer-scan";
import { createChangesHandler } from "../../src/scan-changes";

const edited: Changes = {
  files: [{ path: "app/a.py", kind: "modified" }],
  moved: null,
};
const edited2: Changes = {
  files: [{ path: "app/b.py", kind: "modified" }],
  moved: null,
};

function wire(state: ScanState | null) {
  const calls: string[] = [];
  const stored: ScanState[] = [];
  const handler = createChangesHandler({
    state: () => state,
    setState: (next) => {
      calls.push("set");
      stored.push(next);
    },
    refreshPanel: () => calls.push("refresh"),
  });

  return { calls, stored, handler };
}

describe("createChangesHandler", () => {
  it("publishes the changes and then refreshes the panel", () => {
    const state = { changes: NO_CHANGES } as unknown as ScanState;
    const { calls, stored, handler } = wire(state);

    handler(edited);

    expect(calls).toEqual(["set", "refresh"]);
    expect(stored[0]).toEqual({ ...state, changes: edited });
  });

  it("does nothing without a scan state", () => {
    const { calls, handler } = wire(null);

    handler(edited);

    expect(calls).toEqual([]);
  });

  it("refreshes on each distinct set of changes", () => {
    const state = { changes: NO_CHANGES } as unknown as ScanState;
    const { calls, stored, handler } = wire(state);

    handler(edited);
    handler(edited2);

    expect(calls).toEqual(["set", "refresh", "set", "refresh"]);
    expect(stored[1]?.changes).toEqual(edited2);
  });
});
