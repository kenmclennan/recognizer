import { describe, expect, it } from "vitest";
import type { Point } from "./canvas-layout";
import {
  JOIN_DISTANCE,
  MIN_LINES,
  MIN_SEGMENT,
  MIN_TRUNK_LENGTH,
  planTrunks,
  TITLE_LISTED,
  type TrunkInput,
  trunkLitCount,
  trunkTitle,
  trunkWidth,
} from "./canvas-trunks";

const h = (id: string, y: number, x1: number, x2: number): TrunkInput => ({
  id,
  from: `${id}-from`,
  to: `${id}-to`,
  style: "plain",
  points: [
    { x: x1, y },
    { x: x2, y },
  ],
});

const v = (id: string, x: number, y1: number, y2: number): TrunkInput => ({
  id,
  from: `${id}-from`,
  to: `${id}-to`,
  style: "plain",
  points: [
    { x, y: y1 },
    { x, y: y2 },
  ],
});

const worked = () => [
  h("A", 100, 0, 300),
  h("B", 108, 50, 400),
  h("C", 114, 100, 350),
];

describe("constants", () => {
  it("hold the agreed values", () => {
    expect([MIN_SEGMENT, JOIN_DISTANCE, MIN_LINES, MIN_TRUNK_LENGTH]).toEqual([
      40, 14, 3, 120,
    ]);
    expect(TITLE_LISTED).toBe(12);
  });
});

describe("segment extraction", () => {
  const trunksFor = (length: number) =>
    planTrunks([
      h("a", 0, 0, length),
      h("b", 5, 0, length),
      h("c", 10, 0, length),
    ]).trunks.length;

  it("takes a 40 px segment and not a 39.9 px one", () => {
    expect(
      planTrunks([
        h("a", 0, 0, 40),
        h("b", 5, 0, 40),
        h("c", 10, 0, 40),
      ]).drawn.get("a"),
    ).toBeDefined();
    const loose = (length: number) =>
      planTrunks([
        {
          ...h("a", 0, 0, length),
          points: [
            { x: 0, y: 0 },
            { x: length, y: 0 },
          ],
        },
      ]);

    expect(loose(39.9).trunks).toEqual([]);
    expect(trunksFor(39.9)).toBe(0);
  });

  it("ignores diagonals", () => {
    const diagonal = (id: string, y: number): TrunkInput => ({
      ...h(id, y, 0, 200),
      points: [
        { x: 0, y },
        { x: 200, y: y + 60 },
      ],
    });

    expect(
      planTrunks([diagonal("a", 0), diagonal("b", 4), diagonal("c", 8)]).trunks,
    ).toEqual([]);
  });

  it("takes both legs of an L-shaped route", () => {
    const l = (id: string, offset: number): TrunkInput => ({
      ...h(id, 0, 0, 0),
      points: [
        { x: offset, y: 0 },
        { x: offset, y: 200 },
        { x: offset + 200, y: 200 },
      ],
    });
    const plan = planTrunks([l("a", 0), l("b", 4), l("c", 8)]);

    expect(plan.trunks.map((t) => t.axis).sort()).toEqual(["h", "v"]);
  });

  it("counts a point pair 0.4 px off axis as aligned", () => {
    const skew = (id: string, y: number): TrunkInput => ({
      ...h(id, y, 0, 200),
      points: [
        { x: 0, y },
        { x: 200, y: y + 0.4 },
      ],
    });

    expect(
      planTrunks([skew("a", 0), skew("b", 4), skew("c", 8)]).trunks,
    ).toHaveLength(1);
  });
});

describe("corridor chaining", () => {
  const apart = (gap: number) =>
    planTrunks([
      h("a", 0, 0, 200),
      h("b", gap, 0, 200),
      h("c", gap * 2, 0, 200),
    ]).trunks;

  it("joins neighbours at 14 px and not at 14.5", () => {
    expect(apart(14)).toHaveLength(1);
    expect(apart(14.5)).toHaveLength(0);
  });

  it("chains A to C through B although they are 28 px apart", () => {
    expect(apart(14)[0]?.count).toBe(3);
  });

  it("does not join segments whose spans only touch", () => {
    const plan = planTrunks([
      h("a", 0, 0, 200),
      h("b", 4, 200, 400),
      h("c", 8, 400, 600),
    ]);

    expect(plan.trunks).toEqual([]);
  });

  it("never joins two segments of one line directly", () => {
    const twin: TrunkInput = {
      ...h("a", 0, 0, 0),
      points: [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 5 },
        { x: 0, y: 5 },
      ],
    };

    expect(planTrunks([twin]).trunks).toEqual([]);
  });

  it("keeps a horizontal and a vertical corridor apart", () => {
    const plan = planTrunks([
      h("a", 0, 0, 200),
      h("b", 4, 0, 200),
      h("c", 8, 0, 200),
      v("d", 100, 0, 200),
      v("e", 104, 0, 200),
    ]);

    expect(plan.trunks).toHaveLength(1);
    expect(plan.trunks[0]?.axis).toBe("h");
  });

  it("joins a line running up with lines running down", () => {
    const up = v("up", 0, 200, 0);
    const plan = planTrunks([up, v("b", 4, 0, 200), v("c", 8, 0, 200)]);

    expect(plan.trunks).toHaveLength(1);
    expect(plan.trunks[0]?.lineIds).toEqual(["up", "b", "c"]);
  });
});

describe("cut and count", () => {
  it("makes one trunk of the worked example", () => {
    const [trunk] = planTrunks(worked()).trunks;

    expect(planTrunks(worked()).trunks).toHaveLength(1);
    expect(trunk?.from.x).toBe(100);
    expect(trunk?.to.x).toBe(300);
    expect(trunk?.from.y).toBeCloseTo(107.333, 3);
    expect(trunk?.count).toBe(3);
    expect(trunk?.width).toBeCloseTo(4.036, 3);
  });

  it("makes a trunk of a 120 px stretch and none of 119.9", () => {
    const at = (length: number) =>
      planTrunks([
        h("a", 0, 0, length),
        h("b", 4, 0, length),
        h("c", 8, 0, length),
      ]).trunks.length;

    expect(at(120)).toBe(1);
    expect(at(119.9)).toBe(0);
  });

  it("needs three lines", () => {
    expect(planTrunks([h("a", 0, 0, 200), h("b", 4, 0, 200)]).trunks).toEqual(
      [],
    );
  });

  it("abuts two stretches with their own counts and widths", () => {
    const plan = planTrunks([
      h("a", 0, 0, 400),
      h("b", 4, 0, 400),
      h("c", 8, 0, 400),
      h("d", 12, 200, 400),
    ]);

    expect(plan.trunks.map((t) => t.count)).toEqual([3, 4]);
    expect(plan.trunks[0]?.to).toEqual(plan.trunks[1]?.from);
    expect(plan.trunks[1]?.width).toBeCloseTo(4.7, 3);
  });

  it("draws the piece between two trunk stretches itself", () => {
    const plan = planTrunks([
      h("a", 0, 0, 500),
      h("b", 4, 0, 130),
      h("c", 8, 0, 130),
      h("d", 12, 0, 130),
      h("e", 2, 370, 500),
      h("f", 6, 370, 500),
      h("g", 10, 370, 500),
    ]);
    const pieces = plan.drawn.get("a") ?? [];

    expect(plan.trunks).toHaveLength(2);
    expect(pieces.length).toBeGreaterThanOrEqual(3);
  });
});

describe("replacement", () => {
  it("cuts the worked example's lines into diagonals", () => {
    const plan = planTrunks(worked());
    const m = (100 + 108 + 114) / 3;
    const a = plan.drawn.get("A") as Point[][];
    const b = plan.drawn.get("B") as Point[][];
    const c = plan.drawn.get("C") as Point[][];

    expect(a[0]).toEqual([
      { x: 0, y: 100 },
      { x: 100, y: 100 },
      { x: 100 + (m - 100), y: m },
    ]);
    expect(a[1]?.[0]?.x).toBeCloseTo(300 - (m - 100), 6);
    expect(a[1]?.[1]).toEqual({ x: 300, y: 100 });
    expect(b[0]?.[2]?.x).toBeCloseTo(100.667, 3);
    expect(c[0]?.[1]?.x).toBeCloseTo(106.667, 3);
  });

  it("halves the diagonal on a stretch shorter than twice the offset", () => {
    const plan = planTrunks([
      h("a", 0, 0, 120),
      h("b", 14, 0, 120),
      h("c", 14, 0, 120),
    ]);
    const a = plan.drawn.get("a") as Point[][];
    const m = (0 + 14 + 14) / 3;
    const offset = Math.min(m, 60);

    expect(a[0]?.[a[0].length - 1]).toEqual({ x: offset, y: m });
  });

  it("leaves a line outside every trunk as its whole route", () => {
    const loner = h("z", 900, 0, 200);
    const plan = planTrunks([loner, ...worked()]);

    expect(plan.drawn.get("z")).toEqual([loner.points]);
  });
});

describe("width, style and title", () => {
  it("grows with the log of the count", () => {
    expect(trunkWidth(1)).toBe(1.5);
    expect(trunkWidth(3)).toBeCloseTo(4.036, 3);
    expect(trunkWidth(4)).toBeCloseTo(4.7, 3);
  });

  it("takes the common style, and plain when members differ", () => {
    const style = (styles: TrunkInput["style"][]) =>
      planTrunks(
        styles.map((s, i) => ({ ...h(`l${i}`, i * 4, 0, 200), style: s })),
      ).trunks[0]?.style;

    expect(style(["private", "private", "private"])).toBe("private");
    expect(style(["private", "plain", "private"])).toBe("plain");
  });

  const members = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `l${i}`,
      from: `f${i}`,
      to: `t${i}`,
      style: "plain" as const,
    }));

  it("lists up to 12 and then counts the rest", () => {
    expect(trunkTitle(members(3)).split("\n")).toEqual([
      "3 lines",
      "f0 -> t0",
      "f1 -> t1",
      "f2 -> t2",
    ]);
    expect(trunkTitle(members(12)).split("\n")).toHaveLength(13);
    expect(trunkTitle(members(12))).not.toContain("more");

    const thirteen = trunkTitle(members(13)).split("\n");

    expect(thirteen).toHaveLength(14);
    expect(thirteen.at(-1)).toBe("and 1 more");
    expect(trunkTitle(members(30)).split("\n").at(-1)).toBe("and 18 more");
  });
});

describe("highlight count", () => {
  it("counts only the ids that resolve", () => {
    const [trunk] = planTrunks(worked()).trunks;

    expect(
      trunkLitCount(trunk as NonNullable<typeof trunk>, new Set(["A", "zzz"])),
    ).toBe(1);
  });
});

describe("determinism", () => {
  it("plans the same input to equal plans", () => {
    expect(planTrunks(worked())).toEqual(planTrunks(worked()));
  });
});
