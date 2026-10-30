import type { ViewNote } from "recognizer";
import { describe, expect, it } from "vitest";
import type { Rect } from "./canvas-layout";
import { cardLayout, orderNotes, tint, walk } from "./notes-order";

const at = (x: number, y: number): Rect => ({ x, y, width: 100, height: 40 });
const note = (module: string, text: string, by = "Ken"): ViewNote => ({
  module,
  text,
  by,
});

describe("orderNotes", () => {
  const positions = new Map([
    ["low.py", at(0, 200)],
    ["right.py", at(300, 0)],
    ["left.py", at(0, 0)],
  ]);

  it("groups by box top then left and keeps file order inside a box", () => {
    const order = orderNotes(
      [
        note("low.py", "1"),
        note("right.py", "2"),
        note("left.py", "3"),
        note("low.py", "4"),
      ],
      positions,
    );

    expect(order.groups.map((group) => group.module)).toEqual([
      "left.py",
      "right.py",
      "low.py",
    ]);
    expect(order.groups[2]?.entries.map((entry) => entry.index)).toEqual([
      0, 3,
    ]);
  });

  it("breaks a tie on position by module path", () => {
    const tied = new Map([
      ["b.py", at(0, 0)],
      ["a.py", at(0, 0)],
    ]);

    expect(
      orderNotes([note("b.py", "1"), note("a.py", "2")], tied).groups.map(
        (group) => group.module,
      ),
    ).toEqual(["a.py", "b.py"]);
  });

  it("puts a note on a module that is not on the canvas in off, in file order", () => {
    const order = orderNotes(
      [note("gone.py", "1"), note("left.py", "2"), note("lost.py", "3")],
      positions,
    );

    expect(order.off.map((entry) => entry.index)).toEqual([0, 2]);
    expect(order.groups).toHaveLength(1);
  });
});

describe("walk", () => {
  const order = orderNotes(
    [note("b.py", "1"), note("a.py", "2"), note("a.py", "3")],
    new Map([
      ["a.py", at(0, 0)],
      ["b.py", at(0, 100)],
    ]),
  );

  it("starts from nothing at the first or the last", () => {
    expect(walk(order, null, 1)).toBe(1);
    expect(walk(order, null, -1)).toBe(0);
  });

  it("steps through canvas order and clamps at both ends", () => {
    expect(walk(order, 1, 1)).toBe(2);
    expect(walk(order, 2, 1)).toBe(0);
    expect(walk(order, 0, 1)).toBe(0);
    expect(walk(order, 1, -1)).toBe(1);
  });

  it("keeps the active note when nothing is on the canvas", () => {
    expect(walk({ groups: [], off: [] }, null, 1)).toBeNull();
  });
});

describe("tint", () => {
  it("is person for the window's author and agent for anyone else", () => {
    expect(tint("Ken", "Ken")).toBe("person");
    expect(tint("Claude", "Ken")).toBe("agent");
  });
});

describe("cardLayout", () => {
  it("wraps the text at 28 characters and sizes the card by line", () => {
    const { lines, card } = cardLayout(
      at(10, 20),
      "The one use case; it must not touch the store directly.",
    );

    expect(lines.every((line) => line.length <= 28)).toBe(true);
    expect(lines.length).toBeGreaterThan(1);
    expect(card.height).toBe(lines.length * 18 + 16);
    expect(card.width).toBe(220);
  });

  it("places the card 36 to the right, aligned to the top of the box", () => {
    const { card } = cardLayout(at(10, 20), "x");

    expect(card.x).toBe(10 + 100 + 36);
    expect(card.y).toBe(20);
  });

  it("ends the leader on the middle of the card's left edge", () => {
    const { card, leader } = cardLayout(at(10, 20), "x");
    const numbers = leader.match(/-?\d+(\.\d+)?/g)?.map(Number) as number[];

    expect(leader.startsWith("M 110 40 C")).toBe(true);
    expect(numbers.slice(-2)).toEqual([card.x, card.y + card.height / 2]);
  });

  it("breaks a word longer than the width", () => {
    expect(cardLayout(at(0, 0), "x".repeat(60)).lines).toEqual([
      "x".repeat(28),
      "x".repeat(28),
      "xxxx",
    ]);
  });
});
