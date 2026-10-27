import type { ElkNode } from "elkjs/lib/elk-api";
import { describe, expect, it } from "vitest";
import { layoutOnMainThread } from "./layout-source";
import { lightcycleShapedGraph, SHAPE } from "./lightcycle-shaped-graph";

function count(node: ElkNode, prefix: string): number {
  return (node.children ?? []).reduce(
    (total, child) =>
      total + (child.id.startsWith(prefix) ? 1 : 0) + count(child, prefix),
    0,
  );
}

describe("a graph of lightcycle's shape", () => {
  it("has the boxes, lines and frames the failure was seen at", () => {
    const graph = lightcycleShapedGraph();

    expect(count(graph, "m")).toBe(SHAPE.boxes);
    expect(graph.edges).toHaveLength(SHAPE.lines);
    expect(count(graph, "f:")).toBe(SHAPE.frames);
  });

  it("lays out whole on the main thread", async () => {
    const result = await layoutOnMainThread(lightcycleShapedGraph());

    expect(count(result, "m")).toBe(SHAPE.boxes);
  }, 60000);
});
