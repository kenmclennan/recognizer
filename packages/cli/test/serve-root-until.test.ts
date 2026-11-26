import { describe, expect, it } from "vitest";
import { serveRoot } from "./support/serve-root.js";

describe("serveRoot until", () => {
  it("waits on the real clock for work that answers after the fake budget would run out", async () => {
    const root = serveRoot();
    let answer: string | undefined;

    setTimeout(() => {
      answer = "git answered";
    }, 400);

    const found = await root.until(() => answer, 200);

    expect(found).toBe("git answered");

    await root.close();
  });

  it("still gives up on the fake clock when a due timer never produces the result", async () => {
    const root = serveRoot();

    root.io.timers.after(10, function again() {
      root.io.timers.after(10, again);
    });

    await expect(root.until(() => undefined, 200)).rejects.toThrow(
      "fake clock",
    );

    await root.close();
  });
});
