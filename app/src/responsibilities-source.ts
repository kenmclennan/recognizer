import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ResponsibilitiesPort } from "./responsibilities-port";
import type {
  DescribeResult,
  ResponsibilityFiles,
} from "./responsibility-model";

export const responsibilitiesSource: ResponsibilitiesPort = {
  read: () => invoke<ResponsibilityFiles>("read_responsibilities"),
  describe: (module) => invoke<DescribeResult>("describe_module", { module }),
  onChanged(run) {
    void invoke<void>("watch_responsibilities");

    const pending = listen("responsibilities-changed", () => run());

    return () => void pending.then((stop) => stop());
  },
};
