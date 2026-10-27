import { APP_NAME } from "./app-info";
import type { CheckOutcome } from "./updater";

export type DialogState =
  | { kind: "checking" }
  | { kind: "found"; version: string; error: string | null }
  | { kind: "current" }
  | { kind: "failed"; reason: string }
  | { kind: "upgrading"; version: string };

export type DialogButton = "upgrade" | "close";

export function dialogFromOutcome(outcome: CheckOutcome): DialogState {
  switch (outcome.kind) {
    case "found":
      return { kind: "found", version: outcome.version, error: null };
    case "up-to-date":
      return { kind: "current" };
    case "failed":
      return { kind: "failed", reason: outcome.reason };
    case "installing":
      return { kind: "upgrading", version: outcome.version };
  }
}

export function dialogMessage(state: DialogState, current: string): string {
  switch (state.kind) {
    case "checking":
      return "Checking for updates...";
    case "found":
      return `${APP_NAME} ${state.version} is available (you have ${current})`;
    case "current":
      return `${APP_NAME} ${current} is the latest version`;
    case "failed":
      return `Couldn't check for updates: ${state.reason}`;
    case "upgrading":
      return `Downloading ${APP_NAME} ${state.version}...`;
  }
}

export function dialogError(state: DialogState): string | null {
  return state.kind === "found" ? state.error : null;
}

export function dialogButtons(state: DialogState): DialogButton[] {
  switch (state.kind) {
    case "found":
      return ["upgrade", "close"];
    case "upgrading":
      return [];
    default:
      return ["close"];
  }
}

export function canDismiss(state: DialogState): boolean {
  return state.kind !== "upgrading";
}
