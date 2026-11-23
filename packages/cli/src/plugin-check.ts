import type { PluginCheckReport } from "@recognizer/core";

export function reportLines(report: PluginCheckReport): string[] {
  return report.results.map((entry) =>
    [entry.status.padEnd(4), entry.name, entry.reason]
      .filter((part) => part !== undefined)
      .join("  "),
  );
}

export function reportFailed(report: PluginCheckReport): boolean {
  return report.results.some((entry) => entry.status === "fail");
}
