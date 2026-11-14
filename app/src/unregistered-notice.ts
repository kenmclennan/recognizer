import {
  parseConfig,
  registeredSensors,
  unregisteredSensors,
  unregisteredWarning,
} from "recognizer";
import { UNREGISTERED_KEY_PREFIX } from "./message-tray";
import type { ScanPlan } from "./scan-panel-model";

export type UnregisteredNotice = { key: string; text: string };

const DESCRIBER_NAME = "claude";

function registeredNames(config: string | null): string[] | null {
  if (config === null) {
    return [];
  }

  try {
    return registeredSensors(parseConfig(config)).map((one) => one.name);
  } catch {
    return null;
  }
}

export function unregisteredNotices(
  config: string | null,
  plan: Pick<ScanPlan, "sense" | "describe">,
  describerSource: "config" | "shipped" | null,
): UnregisteredNotice[] {
  const registered = registeredNames(config);

  if (registered === null) {
    return [];
  }

  const names = [
    ...unregisteredSensors(registered, plan.sense),
    ...(plan.describe && describerSource === "shipped" ? [DESCRIBER_NAME] : []),
  ];

  return names.map((name) => ({
    key: `${UNREGISTERED_KEY_PREFIX}${name}`,
    text: unregisteredWarning(name),
  }));
}
