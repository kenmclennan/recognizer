import { describe, expect, it } from "vitest";
import { hubUse } from "../src/hub-use.js";
import type { Scan, ScanEdge } from "../src/scan.js";

const HUB = "a/hub.py";

const hubModule = (members: Scan["modules"][number]["members"]) => ({
  id: HUB,
  kind: "module" as const,
  members,
});

const members: Scan["modules"][number]["members"] = [
  { name: "Small", exported: true, kind: "class", line: 1, end_line: 10 },
  { name: "Big", exported: true, kind: "class", line: 20, end_line: 100 },
];

const edge = (from: string, names?: string[]): ScanEdge =>
  ({ from, to: HUB, kind: "depends", line: 1, names }) as ScanEdge;

const importers = (edges: ScanEdge[]) => new Set(edges.map((e) => e.from));

function twelve(): ScanEdge[] {
  const edges: ScanEdge[] = [];

  for (let i = 1; i <= 8; i += 1) {
    edges.push(edge(`b/i${i}.py`, ["Small"]));
  }

  edges.push(edge("b/i9.py", ["Big"]), edge("b/i10.py", ["Big"]));
  edges.push(edge("b/i11.py", ["Small", "Big"]), edge("b/i12.py"));

  return edges;
}

describe("hubUse names per importer", () => {
  it("lists every importer with its sorted names and [] for unknown", () => {
    const edges = twelve();
    const { used_by } = hubUse(edges, hubModule(members), importers(edges));

    expect(used_by).toHaveLength(12);
    expect(used_by.find((u) => u.module === "b/i11.py")?.names).toEqual([
      "Big",
      "Small",
    ]);
    expect(used_by.find((u) => u.module === "b/i12.py")?.names).toEqual([]);
    expect(used_by.map((u) => u.module)).toEqual(
      [...used_by.map((u) => u.module)].sort(),
    );
  });

  it("is not partly known when one edge has no names", () => {
    const edges = [edge("b/x.py", ["Small"]), edge("b/x.py")];

    expect(hubUse(edges, hubModule(members), importers(edges)).used_by).toEqual(
      [{ module: "b/x.py", names: [] }],
    );
  });

  it("treats an edge with empty names as unknown", () => {
    const edges = [edge("b/x.py", ["Small"]), edge("b/x.py", [])];

    expect(
      hubUse(edges, hubModule(members), importers(edges)).used_by[0]?.names,
    ).toEqual([]);
  });

  it("keeps every importer under mixed resolution and non-member names", () => {
    const edges = [
      edge("b/a.py", ["Nested.Thing"]),
      edge("b/b.py"),
      edge("b/c.py", ["Small"]),
    ];

    expect(hubUse(edges, hubModule(members), importers(edges)).used_by).toEqual(
      [
        { module: "b/a.py", names: ["Nested.Thing"] },
        { module: "b/b.py", names: [] },
        { module: "b/c.py", names: ["Small"] },
      ],
    );
  });

  it("merges the names of two edges from one importer", () => {
    const edges = [edge("b/x.py", ["Small"]), edge("b/x.py", ["Big", "Small"])];

    expect(
      hubUse(edges, hubModule(members), importers(edges)).used_by[0]?.names,
    ).toEqual(["Big", "Small"]);
  });

  it("gives the same result for any edge and member order", () => {
    const edges = twelve();

    expect(
      hubUse(
        [...edges].reverse(),
        hubModule([...(members ?? [])].reverse()),
        importers(edges),
      ),
    ).toEqual(hubUse(edges, hubModule(members), importers(edges)));
  });
});

describe("hubUse size", () => {
  const none = new Set<string>();

  it("reports members and lines from the scan", () => {
    expect(hubUse([], hubModule(members), none)).toMatchObject({
      members: 2,
      lines: 100,
    });
  });

  it("keeps zero members and omits lines", () => {
    const result = hubUse([], hubModule([]), none);

    expect(result.members).toBe(0);
    expect(result.lines).toBeUndefined();
  });

  it("omits lines when no member has a line", () => {
    const result = hubUse(
      [],
      hubModule([{ name: "X", exported: true, kind: "class" }]),
      none,
    );

    expect(result.members).toBe(1);
    expect(result.lines).toBeUndefined();
  });

  it("omits both when the scan carries no members", () => {
    const result = hubUse([], hubModule(undefined), none);

    expect(result.members).toBeUndefined();
    expect(result.lines).toBeUndefined();
  });

  it("extends lines to a method or field past the member's own end", () => {
    const result = hubUse(
      [],
      hubModule([
        {
          name: "C",
          exported: true,
          kind: "class",
          line: 1,
          end_line: 5,
          methods: [{ name: "m", line: 3, end_line: 30 }],
          fields: [{ name: "f", line: 40, private: false }],
        },
      ]),
      none,
    );

    expect(result.lines).toBe(40);
  });
});
