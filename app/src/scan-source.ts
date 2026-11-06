import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  DescribingSettings,
  ScanPort,
  ScanRunResult,
  StoredTicks,
} from "./scan-port";
import type { ScanReport } from "./scan-report";

export const scanSource: ScanPort = {
  run: (plan) =>
    invoke<ScanRunResult>("run_scan", {
      describe: plan.describe,
      describeAll: plan.describeAll,
      measure: [],
      sense: plan.sense,
      modules: plan.modules,
    }),
  stop: () => invoke<void>("stop_scan"),
  readCache: () => invoke<ScanReport>("read_scan_cache"),
  readTicks: () => invoke<StoredTicks>("read_scan_ticks"),
  writeTicks: (ticks) =>
    invoke<void>("write_scan_ticks", {
      describe: ticks.describe,
      ticked: ticks.ticked,
      onlyView: ticks.onlyView,
    }),
  readDescribing: () => invoke<DescribingSettings>("read_describing"),
  onLine(handler) {
    const pending = listen<string>("scan-event", (event) =>
      handler(event.payload),
    );

    return () => void pending.then((stop) => stop());
  },
};
