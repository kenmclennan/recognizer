import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import type { FoundUpdate, UpdaterPorts } from "./updater";

export const tauriUpdaterPorts: Pick<
  UpdaterPorts,
  "check" | "relaunch" | "schedule" | "scheduleEvery"
> = {
  async check(): Promise<FoundUpdate | null> {
    const update = await check();

    if (update === null) {
      return null;
    }

    return {
      version: update.version,
      install: () => update.downloadAndInstall(),
    };
  },
  relaunch: () => relaunch(),
  schedule(run, ms) {
    const id = setTimeout(run, ms);

    return () => clearTimeout(id);
  },
  scheduleEvery(run, ms) {
    const id = setInterval(run, ms);

    return () => clearInterval(id);
  },
};
