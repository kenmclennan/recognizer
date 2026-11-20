export type CheckState = "checked" | "partial" | "unchecked";

export function checkState(
  files: string[],
  isOpen: (id: string) => boolean,
): CheckState {
  if (files.length === 0) {
    return "unchecked";
  }

  const on = files.filter(isOpen).length;

  if (on === 0) {
    return "unchecked";
  }

  return on === files.length ? "checked" : "partial";
}

export function nextCheck(state: CheckState): "putOn" | "takeOff" {
  return state === "checked" ? "takeOff" : "putOn";
}
