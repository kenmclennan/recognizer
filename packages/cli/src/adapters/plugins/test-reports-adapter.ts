import { discoverPlugins, type TestReports } from "@recognizer/core";
import type { Io } from "../../cli.js";
import validate from "../../generated/tests-answer-validator.js";
import { manifestPorts } from "../../manifest-ports.js";

export const TESTS_REPORT_TIMEOUT_MS = 120_000;

function parseEntries(text: string): Map<string, string> | null {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }

  if (!validate(value)) {
    return null;
  }

  return new Map(
    Object.entries((value as { entries: Record<string, string> }).entries),
  );
}

export class TestReportsAdapter implements TestReports {
  constructor(
    private readonly io: Io,
    private readonly timeoutMs: number = TESTS_REPORT_TIMEOUT_MS,
  ) {}

  entries(root: string): Map<string, string> | null {
    const ports = manifestPorts(this.io);
    const asked = discoverPlugins(ports, ["scanner"]).plugins.filter(
      (plugin) => plugin.manifest.reports_tests === true,
    );
    const merged = new Map<string, string>();

    for (const plugin of asked) {
      const run = ports.programs.run(plugin.command, ["tests", root], {
        timeoutMs: this.timeoutMs,
      });

      if (!run.started || run.timedOut || run.status !== 0) {
        return null;
      }

      const entries = parseEntries(run.stdout);

      if (entries === null) {
        return null;
      }

      for (const [key, hash] of entries) {
        merged.set(key, hash);
      }
    }

    return merged;
  }
}
