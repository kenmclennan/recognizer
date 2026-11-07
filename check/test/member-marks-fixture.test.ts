import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { memberMarks } from "../src/member-marks.js";
import type { RecordedScan, ScanMember } from "../src/scan.js";
import { REPO } from "./helpers.js";

const MODULE = "shop/domain/order.py";
const HEAD = "headcommit";
const recorded = JSON.parse(
  readFileSync(join(REPO, "fixtures/python/expected-scan.json"), "utf8"),
) as RecordedScan;
const baseText = readFileSync(
  join(REPO, "fixtures/python/sample", MODULE),
  "utf8",
);

function withMembers(members: ScanMember[], extra: Partial<RecordedScan>) {
  return {
    ...recorded,
    ...extra,
    modules: recorded.modules.map((module) =>
      module.id === MODULE ? { ...module, members } : module,
    ),
  };
}

describe("memberMarks over the committed python sample", () => {
  it("marks one function added, one removed and one modified", () => {
    const lines = baseText.split("\n");
    const kept = lines
      .slice(0, 27)
      .join("\n")
      .replace("return _build(order_id)", "return _build(str(order_id))");
    const headText = `${kept}\n\ndef fresh():\n    return 1\n`;
    const baseMembers = recorded.modules.find((m) => m.id === MODULE)
      ?.members as ScanMember[];
    const headMembers: ScanMember[] = [
      ...baseMembers.filter((member) => member.name !== "_private"),
      {
        name: "fresh",
        exported: false,
        kind: "function",
        line: 29,
        end_line: 30,
      },
    ];
    const marks = memberMarks({
      modules: [{ id: MODULE, mark: "modified", box: "current" }],
      headCommit: HEAD,
      current: [withMembers(headMembers, { commit: HEAD, modified: false })],
      base: [withMembers(baseMembers, { commit: null })],
      files: [{ path: MODULE, base_text: baseText, head_text: headText }],
    });

    expect(marks.get(MODULE)).toEqual(
      new Map([
        ["_private", "removed"],
        ["fresh", "added"],
        ["new_order", "modified"],
      ]),
    );
  });
});
