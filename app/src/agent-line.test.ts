import { describe, expect, it } from "vitest";
import { agentLineOf, backLabel, forwardLabel } from "./agent-line";

const mark = { by: "Claude", summary: "added 4 modules" };

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
});
