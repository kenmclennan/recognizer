import type { Point, Rect } from "./canvas-layout";

export type Viewport = { x: number; y: number; k: number };
export type Size = { width: number; height: number };

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 2.5;
export const FIT_MARGIN = 40;

export const clampZoom = (k: number) =>
  Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

export function zoomAt(
  viewport: Viewport,
  factor: number,
  point: Point,
): Viewport {
  const k = clampZoom(viewport.k * factor);
  const scale = k / viewport.k;

  return {
    k,
    x: point.x - (point.x - viewport.x) * scale,
    y: point.y - (point.y - viewport.y) * scale,
  };
}

export function panBy(viewport: Viewport, dx: number, dy: number): Viewport {
  return { ...viewport, x: viewport.x + dx, y: viewport.y + dy };
}

export function fitToBounds(bounds: Rect, size: Size): Viewport {
  if (bounds.width === 0 || bounds.height === 0) {
    return { x: 0, y: 0, k: 1 };
  }

  const k = clampZoom(
    Math.min(
      1,
      (size.width - FIT_MARGIN * 2) / bounds.width,
      (size.height - FIT_MARGIN * 2) / bounds.height,
    ),
  );

  return {
    k,
    x: (size.width - bounds.width * k) / 2 - bounds.x * k,
    y: (size.height - bounds.height * k) / 2 - bounds.y * k,
  };
}

export function centerOn(viewport: Viewport, rect: Rect, size: Size): Viewport {
  return {
    k: viewport.k,
    x: size.width / 2 - (rect.x + rect.width / 2) * viewport.k,
    y: size.height / 2 - (rect.y + rect.height / 2) * viewport.k,
  };
}

export const atMin = (viewport: Viewport) => viewport.k <= MIN_ZOOM;
export const atMax = (viewport: Viewport) => viewport.k >= MAX_ZOOM;
export const zoomLabel = (viewport: Viewport) =>
  `${Math.round(viewport.k * 100)}%`;
