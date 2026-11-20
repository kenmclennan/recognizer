export type WheelInput = {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
};

export type WheelClass = "pinch" | "mouse-wheel" | "trackpad-scroll";

export const MOUSE_STEP_MIN = 50;

export function classifyWheel(event: WheelInput): WheelClass {
  if (event.ctrlKey) {
    return "pinch";
  }

  if (event.deltaMode === 1 || event.deltaMode === 2) {
    return "mouse-wheel";
  }

  if (
    event.deltaMode === 0 &&
    event.deltaX === 0 &&
    Number.isInteger(event.deltaY) &&
    Math.abs(event.deltaY) >= MOUSE_STEP_MIN
  ) {
    return "mouse-wheel";
  }

  return "trackpad-scroll";
}
