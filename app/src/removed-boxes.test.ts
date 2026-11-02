import { describe, expect, it } from "vitest";
import type { Scene } from "./canvas-scene";
import { REMOVED_GAP, removedPlacement } from "./removed-boxes";

const scene = {
  boxes: [{ rect: { x: 10, y: 20, width: 100, height: 30 } }],
  bounds: { x: 10, y: 20, width: 300, height: 200 },
} as unknown as Scene;

describe("removedPlacement", () => {
  it("places removed boxes in a row below the scene, in path order", () => {
    const placed = removedPlacement(scene, ["z/b.py", "a/x.py"]);

    expect(placed.map((box) => [box.id, box.name])).toEqual([
      ["a/x.py", "x.py"],
      ["z/b.py", "b.py"],
    ]);
    expect(placed[0]?.rect).toEqual({ x: 10, y: 260, width: 100, height: 30 });
    expect(placed[1]?.rect.x).toBe(10 + 100 + REMOVED_GAP);
  });

  it("starts at the origin on an empty scene", () => {
    const empty = { boxes: [], bounds: { x: 0, y: 0, width: 0, height: 0 } };

    expect(
      removedPlacement(empty as unknown as Scene, ["a.py"])[0]?.rect,
    ).toMatchObject({ x: 0, y: 0 });
  });
});
