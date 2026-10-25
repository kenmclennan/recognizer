import type { UpdateState } from "./updater";

export function updateLabel(name: string, state: UpdateState): string {
  switch (state.kind) {
    case "available":
      return `${name} ${state.version} available - Install`;
    case "installing":
      return `Installing ${name} ${state.version}...`;
    case "none":
      return "";
  }
}
