import type { Scan, ScanMember } from "recognizer";
import { describe, expect, it } from "vitest";
import { compactFolders } from "./folder-compaction";
import { DEFAULT_LIMITS } from "./function-limits";
import {
  type CardRow,
  type InspectorInputs,
  type InspectorMembers,
  inspectorContent,
} from "./inspector-model";
import type { MemberMarkWord } from "./member-mark";

const ID = "pkg/m.py";

const fn = (name: string, line: number, end_line: number): ScanMember => ({
  name,
  exported: true,
  kind: "function",
  line,
  end_line,
});

const klass = (
  name: string,
  line: number,
  methods: { name: string; line: number; end_line: number }[],
): ScanMember => ({
  name,
  exported: true,
  kind: "class",
  line,
  methods,
});

function scanOf(members: ScanMember[]): Scan {
  return {
    modules: [{ id: ID, kind: "module", members }],
    edges: [],
    foreign: [],
  };
}

function cards(
  members: ScanMember[],
  marks: Record<string, MemberMarkWord>,
  extra: Partial<InspectorMembers> = {},
): CardRow[] {
  const inputs: InspectorInputs = {
    scans: [scanOf(members)],
    modules: [ID],
    compaction: compactFolders([ID]),
    disc: () => "green",
    findings: () => [],
    findingRows: () => [],
    onCanvas: () => false,
    expanded: new Set(),
    showPrivate: false,
    tab: "contents",
    counts: () => ({ uses: 0, usedBy: 0 }),
    filter: "",
    followed: null,
    responsibility: () => ({ state: { kind: "missing" }, failure: null }),
    metrics: [],
    metricsOn: false,
    limits: DEFAULT_LIMITS,
    members: {
      mark: (_module, key) => marks[key] ?? null,
      planned: () => [],
      start: () => null,
      note: () => null,
      ...extra,
    },
  };

  return inspectorContent({ kind: "module", id: ID }, inputs).rows.filter(
    (row): row is CardRow => row.kind === "card",
  );
}

const ORDER = klass("Order", 1, [
  { name: "total", line: 2, end_line: 3 },
  { name: "apply", line: 5, end_line: 6 },
]);

describe("member marks in the inspector contents", () => {
  it("marks a top-level card and a method row", () => {
    const [order, helper] = cards([ORDER, fn("helper", 9, 10)], {
      "Order.total": "changes",
      helper: "removed",
    });

    expect(order?.mark).toBeUndefined();
    expect(order?.lines[0]?.mark).toEqual({ word: "changes", icon: "delta" });
    expect(order?.lines[1]?.mark).toBeUndefined();
    expect(helper?.mark).toEqual({ word: "removed", icon: "minus" });
  });

  it("strikes a removed member that is still in the scan and draws no mark on a modified class", () => {
    const [order, helper] = cards([ORDER, fn("helper", 9, 10)], {
      Order: "modified",
      helper: "removed",
    });

    expect(order?.mark).toBeUndefined();
    expect(order?.look).toBeUndefined();
    expect(helper?.look).toBe("removed");
  });

  it("draws marks on member rows only when the class and its methods changed", () => {
    const [order] = cards([ORDER], {
      Order: "modified",
      "Order.total": "modified",
      "Order.apply": "added",
    });

    expect(order?.mark).toBeUndefined();
    expect(order?.lines.map((line) => line.mark?.word)).toEqual([
      "modified",
      "added",
    ]);
  });

  it("draws no card mark on a class whose only change is outside its members", () => {
    const [order] = cards([ORDER], { Order: "modified" });

    expect(order?.mark).toBeUndefined();
    expect(order?.lines.every((line) => line.mark === undefined)).toBe(true);
  });

  it("names the marked hidden private methods in the hidden line", () => {
    const priv = klass("Cart", 1, [
      { name: "total", line: 2, end_line: 3 },
      { name: "_a", line: 5, end_line: 6 },
      { name: "_b", line: 8, end_line: 9 },
    ]);

    priv.methods = priv.methods?.map((method) =>
      method.name.startsWith("_") ? { ...method, private: true } : method,
    );

    const [cart] = cards([priv], {
      Cart: "modified",
      "Cart.total": "modified",
      "Cart._a": "added",
    });

    expect(cart?.mark).toBeUndefined();
    expect(cart?.hidden).toBe("2 private methods hidden, 1 added");
  });

  it("draws no mark without a members input", () => {
    const rows = inspectorContent(
      { kind: "module", id: ID },
      {
        scans: [scanOf([ORDER])],
        modules: [ID],
        compaction: compactFolders([ID]),
        disc: () => "green",
        findings: () => [],
        findingRows: () => [],
        onCanvas: () => false,
        expanded: new Set(),
        showPrivate: false,
        tab: "contents",
        counts: () => ({ uses: 0, usedBy: 0 }),
        filter: "",
        followed: null,
        responsibility: () => ({ state: { kind: "missing" }, failure: null }),
        metrics: [],
        metricsOn: false,
        limits: DEFAULT_LIMITS,
      },
    ).rows;

    expect(JSON.stringify(rows)).not.toContain('"mark"');
  });

  it("puts a planned method at the end of its class card, italic with no line", () => {
    const [order] = cards([ORDER], {}, { planned: () => ["Order.discount"] });
    const last = order?.lines.at(-1);

    expect(order?.lines).toHaveLength(3);
    expect(last?.line).toBeNull();
    expect(last?.look).toBe("planned");
    expect(last?.mark).toEqual({ word: "new", icon: "plus" });
    expect(last?.tokens.map((token) => token.text).join("")).toBe("discount");
  });

  it("makes a planned top-level member a Member card after the others", () => {
    const rows = cards([ORDER], {}, { planned: () => ["round_money"] });

    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      label: "Member",
      line: null,
      look: "planned",
      mark: { word: "new" },
    });
  });

  it("nests planned methods under a planned class and names a method of an unknown class in full", () => {
    const rows = cards(
      [ORDER],
      {},
      { planned: () => ["Coupon", "Coupon.apply", "Ghost.run"] },
    );

    expect(rows.map((row) => row.head.map((t) => t.text).join(""))).toEqual([
      expect.stringContaining("Order"),
      "Coupon",
      "Ghost.run",
    ]);
    expect(rows[1]?.lines).toHaveLength(1);
    expect(rows[1]?.lines[0]?.tokens[0]?.text).toBe("apply");
  });

  it("draws a removed member from the start scan after its nearest surviving predecessor", () => {
    const start = [fn("first", 1, 2), fn("gone", 4, 5), fn("last", 7, 8)];
    const end = [fn("first", 1, 2), fn("last", 4, 5)];
    const rows = cards(end, { gone: "removed" }, { start: () => start });

    expect(
      rows.map((row) => row.head.map((token) => token.text).join("")),
    ).toEqual([
      expect.stringContaining("first"),
      expect.stringContaining("gone"),
      expect.stringContaining("last"),
    ]);
    expect(rows[1]).toMatchObject({
      line: null,
      look: "removed",
      mark: { word: "removed" },
    });
  });

  it("puts a removed member first when nothing before it survives", () => {
    const start = [fn("gone", 1, 2), fn("kept", 4, 5)];
    const rows = cards(
      [fn("kept", 1, 2)],
      { gone: "removed" },
      { start: () => start },
    );

    expect(rows[0]?.look).toBe("removed");
  });

  it("draws a removed method in its class card", () => {
    const start = klass("Order", 1, [
      { name: "total", line: 2, end_line: 3 },
      { name: "old", line: 5, end_line: 6 },
      { name: "apply", line: 8, end_line: 9 },
    ]);
    const end = klass("Order", 1, [
      { name: "total", line: 2, end_line: 3 },
      { name: "apply", line: 5, end_line: 6 },
    ]);
    const [order] = cards(
      [end],
      { "Order.old": "removed" },
      { start: () => [start] },
    );

    expect(order?.lines).toHaveLength(3);
    expect(order?.lines[1]).toMatchObject({ line: null, look: "removed" });
  });

  it("puts the module's note above the cards", () => {
    const inputs = inspectorContent(
      { kind: "module", id: ID },
      {
        scans: [scanOf([ORDER])],
        modules: [ID],
        compaction: compactFolders([ID]),
        disc: () => "green",
        findings: () => [],
        findingRows: () => [],
        onCanvas: () => false,
        expanded: new Set(),
        showPrivate: false,
        tab: "contents",
        counts: () => ({ uses: 0, usedBy: 0 }),
        filter: "",
        followed: null,
        responsibility: () => ({ state: { kind: "missing" }, failure: null }),
        metrics: [],
        metricsOn: false,
        limits: DEFAULT_LIMITS,
        members: {
          mark: () => null,
          planned: () => [],
          start: () => null,
          note: () => "Member marks loading",
        },
      },
    );

    expect(inputs.rows[1]).toEqual({
      kind: "note",
      text: "Member marks loading",
    });
  });
});
