import {
  CORE_KEYS,
  discoverPlugins,
  type PaneDescriber,
  publish,
  readInstalledSensors,
  settingsPanes,
} from "@recognizer/core";
import { KeyOwnersAdapter } from "../adapters/plugins/key-owners-adapter.js";
import type { Io } from "../cli.js";
import { manifestPorts } from "../manifest-ports.js";

export function settingsPanesReply(io: Io): unknown {
  try {
    const ports = manifestPorts(io);
    const installed = readInstalledSensors(ports);
    const describers: PaneDescriber[] = discoverPlugins(ports, [
      "describer",
    ]).plugins.map((plugin) => ({
      name: plugin.name,
      display: plugin.manifest.display,
      ...(plugin.manifest.settings_title === undefined
        ? {}
        : { settings_title: plugin.manifest.settings_title }),
      settings: plugin.manifest.settings,
    }));
    const owners = new KeyOwnersAdapter(io).schemas();
    const published = publish([CORE_KEYS, owners.schema], "config");

    return {
      status: "ok",
      panes: settingsPanes({
        sensors: installed.sensors,
        describers,
        published,
      }),
    };
  } catch (error) {
    return { status: "unavailable", reason: (error as Error).message };
  }
}
