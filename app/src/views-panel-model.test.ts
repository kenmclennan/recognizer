import type { Scan } from "recognizer";
import { describe, expect, it } from "vitest";
import {
  dropdownNames,
  rangeOf,
  showsAllLink,
  viewsPanelModel,
} from "./views-panel-model";

const scan = {
  modules: [{ id: "a.py", kind: "module" }],
  edges: [],
  foreign: [],
} as unknown as Scan;

const text = (extra: Record<string, unknown>, module = "a.py") =>
  JSON.stringify({
    schema_version: 4,
    description: "d",
    commit: null,
    ...extra,
    steps: [{ kind: "pick", module }],
  });

describe("viewsPanelModel", () => {
  it("puts live views first by name and stale ones apart with reasons", () => {
    const facts = new Map([
      ["merged", { headCommit: "h", baseCommit: "b", merged: true }],
    ]);
    const model = viewsPanelModel(
      [
        { name: "zeta", text: text({}) },
        {
          name: "merged",
          text: text({ change: { base: "main", head: "old" } }),
        },
        { name: "broken", text: text({}, "gone.py") },
        { name: "alpha", text: text({}) },
        { name: "bad", text: "{nope" },
      ],
      [scan],
      facts,
    );

    expect(model.live.map((row) => [row.name, row.range])).toEqual([
      ["alpha", null],
      ["zeta", null],
    ]);
    expect(model.stale.map((row) => [row.name, row.reasons])).toEqual([
      ["broken", ["step 1 gone.py no longer resolves"]],
      ["merged", ["head old is merged into main"]],
    ]);
    expect(model.invalid.map((row) => row.name)).toEqual(["bad"]);
  });

  it("counts notes and keeps a change view live with no git answer", () => {
    const model = viewsPanelModel(
      [
        {
          name: "c",
          text: text({
            change: { base: "main", head: "feat" },
            notes: [{ module: "a.py", text: "x", by: "K" }],
          }),
        },
      ],
      [scan],
      new Map(),
    );

    expect(model.live[0]).toMatchObject({ range: "main..feat", notes: 1 });
    expect(model.stale).toEqual([]);
  });
});

describe("dropdownNames", () => {
  it("lists recent first, topped up in name order, at most five", () => {
    expect(
      dropdownNames(["a", "b", "c", "d", "e", "f", "g"], ["g", "gone", "c"]),
    ).toEqual(["g", "c", "a", "b", "d"]);
  });

  it("offers the All views link only past five", () => {
    expect(showsAllLink(5)).toBe(false);
    expect(showsAllLink(6)).toBe(true);
  });

  it("names a change view by its range", () => {
    expect(
      rangeOf({
        schema_version: 4,
        description: "d",
        commit: null,
        change: { base: "a", head: "b" },
        steps: [],
      }),
    ).toBe("a..b");
  });
});
