import type { Scan, View } from "recognizer";
import { describe, expect, it } from "vitest";
import {
  dropdownNames,
  metaOf,
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

    expect(model.live.map((row) => [row.name, row.meta])).toEqual([
      ["alpha", null],
      ["zeta", null],
    ]);
    expect(model.stale.map((row) => [row.name, row.reasons])).toEqual([
      ["broken", ["step 1 gone.py no longer resolves"]],
      ["merged", ["head old is merged into main"]],
    ]);
    expect(model.invalid.map((row) => row.name)).toEqual(["bad"]);
  });

  it("carries the title of a titled file and null for an untitled one", () => {
    const model = viewsPanelModel(
      [
        { name: "a", text: text({ title: "A title" }) },
        { name: "b", text: text({}) },
      ],
      [scan],
      new Map(),
    );

    expect(model.live.map((row) => row.title)).toEqual(["A title", null]);
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

    expect(model.live[0]).toMatchObject({
      title: null,
      meta: "Changes main to feat \u00b7 1 note",
    });
    expect(model.stale).toEqual([]);
  });
});

describe("metaOf", () => {
  const view = (extra: Record<string, unknown>) =>
    ({
      schema_version: 4,
      description: "d",
      commit: null,
      steps: [],
      ...extra,
    }) as unknown as View;
  const note = (module: string) => ({ module, text: "x", by: "K" });

  it("counts notes on an ordinary view and is null with none", () => {
    expect(metaOf(view({}))).toBeNull();
    expect(metaOf(view({ notes: [note("a.py")] }))).toBe("1 note");
    expect(
      metaOf(view({ notes: [note("a.py"), note("b.py"), note("c.py")] })),
    ).toBe("3 notes");
  });

  it("names a change view's refs, then its notes", () => {
    const change = { base: "main", head: "feat" };

    expect(metaOf(view({ change }))).toBe("Changes main to feat");

    const base = "c1933e0".padEnd(40, "1");
    const head = "9e7f13b".padEnd(40, "2");

    expect(
      metaOf(
        view({
          change: { base, head },
          notes: ["a", "b", "c", "d"].map((m) => note(`${m}.py`)),
        }),
      ),
    ).toBe("Changes c1933e0 to 9e7f13b \u00b7 4 notes");
    expect(metaOf(view({ change: { base: "abcdef0", head: "feat" } }))).toBe(
      "Changes abcdef0 to feat",
    );
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
