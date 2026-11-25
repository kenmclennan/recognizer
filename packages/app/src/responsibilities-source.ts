import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ResponsibilitiesPort } from "./responsibilities-port";
import type { ResponsibilityRead } from "./responsibility-model";
import { coreReply } from "./scan-source";

export const responsibilitiesSource: ResponsibilitiesPort = {
  async read(modules) {
    return coreReply<ResponsibilityRead>(
      await invoke("core_call", {
        op: "responsibilities.read",
        args: { modules },
      }),
    );
  },
  onChanged(run) {
    void invoke<void>("watch_responsibilities");

    const pending = listen("responsibilities-changed", () => run());

    return () => void pending.then((stop) => stop());
  },
};
