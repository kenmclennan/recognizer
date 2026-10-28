import { describe, expect, it } from "vitest";
import { currentViewOf, latestWins } from "./current-view";

describe("currentViewOf", () => {
  it("sorts the modules and carries the rest", () => {
    expect(
      currentViewOf({
        view: "overview",
        modules: ["b.py", "a.py"],
        folded: ["z", "y"],
        focus: null,
        selection: { kind: "module", id: "a.py" },
      }),
    ).toEqual({
      schema_version: 1,
      view: "overview",
      modules: ["a.py", "b.py"],
      folded: ["y", "z"],
      focus: null,
      selection: { kind: "module", id: "a.py" },
    });
  });
});

describe("latestWins", () => {
  it("keeps one write in flight and only the newest pending text", async () => {
    const written: string[] = [];
    const release: (() => void)[] = [];
    const enqueue = latestWins(
      (text) =>
        new Promise<void>((resolve) => {
          written.push(text);
          release.push(resolve);
        }),
    );

    enqueue("one");
    enqueue("two");
    enqueue("three");

    expect(written).toEqual(["one"]);

    release[0]();
    await Promise.resolve();
    await Promise.resolve();

    expect(written).toEqual(["one", "three"]);

    release[1]();
    await Promise.resolve();
    await Promise.resolve();

    expect(written).toHaveLength(2);
  });

  it("goes on writing after a failed write", async () => {
    const written: string[] = [];
    const enqueue = latestWins(async (text) => {
      written.push(text);

      if (text === "bad") {
        throw new Error("no");
      }
    });

    enqueue("bad");
    await new Promise((resolve) => setTimeout(resolve, 0));
    enqueue("good");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(written).toEqual(["bad", "good"]);
  });
});
