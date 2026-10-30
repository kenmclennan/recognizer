import { describe, expect, it } from "vitest";
import {
  AGENT_LINE_MS,
  type AgentLineView,
  agentLineOf,
  backLabel,
  createAgentLine,
  forwardLabel,
  type SetTimer,
} from "./agent-line";

const mark = { by: "Claude", summary: "added 4 modules" };

function harness() {
  const shown: AgentLineView[] = [];
  const timers: { run: () => void; ms: number; live: boolean }[] = [];
  const setTimer: SetTimer = (run, ms) => {
    const timer = { run, ms, live: true };

    timers.push(timer);

    return () => {
      timer.live = false;
    };
  };
  const line = createAgentLine((view) => shown.push(view), setTimer);

  return { line, shown, timers };
}

describe("agent line", () => {
  it("words the line as who and what", () => {
    expect(agentLineOf(mark)).toBe("Claude added 4 modules");
  });

  it("labels back and forward for an agent entry and plainly for a user's", () => {
    expect(backLabel(null)).toBe("Back");
    expect(forwardLabel(null)).toBe("Forward");
    expect(backLabel(mark)).toBe("Back - undo Claude: added 4 modules");
    expect(forwardLabel(mark)).toBe("Forward - redo Claude: added 4 modules");
  });

  it("shows the text and starts a 6000 ms timer", () => {
    const { line, shown, timers } = harness();

    line.show(mark, () => {});

    expect(shown[0]?.text).toBe("Claude added 4 modules");
    expect(timers).toHaveLength(1);
    expect(timers[0]?.ms).toBe(AGENT_LINE_MS);
    expect(AGENT_LINE_MS).toBe(6000);
  });

  it("replaces the line and restarts the timer", () => {
    const { line, shown, timers } = harness();

    line.show(mark, () => {});
    line.show({ by: "Claude", summary: "removed 1 module" }, () => {});

    expect(shown.at(-1)?.text).toBe("Claude removed 1 module");
    expect(timers[0]?.live).toBe(false);
    expect(timers[1]?.live).toBe(true);
  });

  it("clears when the timer fires", () => {
    const { line, shown, timers } = harness();

    line.show(mark, () => {});
    timers[0]?.run();

    expect(shown.at(-1)).toBeNull();
  });

  it("clears at once and cancels the timer when cleared by a user change, Back, Forward or Undo", () => {
    const { line, shown, timers } = harness();

    line.show(mark, () => {});
    line.clear();

    expect(shown.at(-1)).toBeNull();
    expect(timers[0]?.live).toBe(false);
  });

  it("hands Undo through to the caller", () => {
    const { line, shown } = harness();
    let undone = 0;

    line.show(mark, () => {
      undone += 1;
    });
    shown[0]?.onUndo();

    expect(undone).toBe(1);
  });
});
