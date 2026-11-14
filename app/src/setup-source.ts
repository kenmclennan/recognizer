import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  DoctorRead,
  SetupApplyResult,
  SetupCheckResult,
  SetupPort,
} from "./setup-port";

export const setupSource: SetupPort = {
  readDoctor: () => invoke<DoctorRead>("read_doctor"),
  check: (prompt, schema, budget) =>
    invoke<SetupCheckResult>("run_setup_check", { prompt, schema, budget }),
  apply: (commands) => invoke<SetupApplyResult>("apply_setup", { commands }),
  stop: () => invoke<void>("stop_setup"),
  onLine(handler) {
    const stop = listen<string>("setup-run-line", (event) =>
      handler(event.payload),
    );

    return () => void stop.then((unlisten) => unlisten());
  },
};
