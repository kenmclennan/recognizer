import { describe, expect, it } from "vitest";
import { createViewsSource } from "../../src/views-source";

describe("the views source", () => {
  it("routes_each_call_through_core_call", async () => {
    const calls: { command: string; args: Record<string, unknown> }[] = [];
    const replies: Record<string, unknown> = {
      "view.range": null,
      "view.renames": [{ from: "a", to: "b" }],
      "view.author": "Ada",
      "view.scans": { ok: false, reason: "no" },
      "view.members": { ok: false, reason: "no" },
    };
    const source = createViewsSource((async (
      command: string,
      args: Record<string, unknown> = {},
    ) => {
      calls.push({ command, args });

      return { ok: replies[(args.op as string) ?? ""] };
    }) as never);

    expect(await source.changeRange("main", "topic")).toBeNull();
    expect(await source.renamesSince("abcdef1")).toEqual([
      { from: "a", to: "b" },
    ]);
    expect(await source.author()).toBe("Ada");
    expect(await source.scansAt("abcdef1")).toEqual({
      ok: false,
      reason: "no",
    });
    expect(await source.rangeMembers("main", "topic")).toEqual({
      ok: false,
      reason: "no",
    });

    expect(calls.map((call) => call.command)).toEqual(
      Array(5).fill("core_call"),
    );
    expect(calls.map((call) => call.args)).toEqual([
      { op: "view.range", args: { base: "main", head: "topic" } },
      { op: "view.renames", args: { commit: "abcdef1" } },
      { op: "view.author", args: {} },
      { op: "view.scans", args: { commit: "abcdef1" } },
      { op: "view.members", args: { base: "main", head: "topic" } },
    ]);
  });

  it("maps a members reply to the port's snake-case file fields", async () => {
    const source = createViewsSource((async () => ({
      ok: {
        ok: true,
        baseScans: [],
        headScans: [],
        files: [
          { path: "a.ts", basePath: "b.ts", baseText: "old", headText: null },
        ],
      },
    })) as never);
    const found = await source.rangeMembers("main", "topic");

    expect(found.ok && found.value.files).toEqual([
      { path: "a.ts", base_path: "b.ts", base_text: "old", head_text: null },
    ]);
  });
});
