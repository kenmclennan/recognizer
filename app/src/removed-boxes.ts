import type { Rect } from "./canvas-layout";
import type { Scene } from "./canvas-scene";

export type RemovedBox = { id: string; name: string; rect: Rect };

export const REMOVED_GAP = 40;
export const REMOVED_ROW_GAP = 16;
export const REMOVED_PER_ROW = 4;

const FALLBACK = { width: 180, height: 44 };

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function removedPlacement(scene: Scene, ids: string[]): RemovedBox[] {
  const sample = scene.boxes[0]?.rect ?? FALLBACK;
  const left = scene.boxes.length === 0 ? 0 : scene.bounds.x;
  const top =
    scene.boxes.length === 0
      ? 0
      : scene.bounds.y + scene.bounds.height + REMOVED_GAP;

  return [...ids].sort().map((id, index) => ({
    id,
    name: fileName(id),
    rect: {
      x: left + (index % REMOVED_PER_ROW) * (sample.width + REMOVED_GAP),
      y:
        top +
        Math.floor(index / REMOVED_PER_ROW) * (sample.height + REMOVED_ROW_GAP),
      width: sample.width,
      height: sample.height,
    },
  }));
}
