import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RunLogRepository } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../../tools/scripts/temp-dirs.mjs";
import { FakeRunLogRepository } from "../../../core/test/fakes/fake-run-log-repository.js";
import { RunLogAdapter } from "../../src/adapters/filesystem/run-log-adapter.js";
import { nodeIo } from "../../src/cli.js";
import { validateRunRecord } from "../../src/log-document.js";
import { logDirectory } from "../../src/run-log.js";

interface Seen {
  runId: string | undefined;
  outcome: string;
}

interface Made {
  repository: RunLogRepository;
  root: string;
  records: () => Seen[];
}

const START = Date.parse("2026-11-27T02:38:51.494Z");

function killed(runId: string, startedAt: number) {
  return {
    runId,
    startedAt: new Date(startedAt).toISOString(),
    startedBy: "cli",
    running: [],
  };
}

function suite(title: string, make: () => Made): void {
  describe(title, () => {
    it.each([60_000, -60_000])(
      "a_killed_run_is_settled_in_place_whatever_its_start_time (offset %i ms)",
      (offset) => {
        const { repository, root, records } = make();

        repository.open(root, START, "tester", ["scan"], "run-a");

        expect(records()).toHaveLength(1);

        repository.settleKilled(root, killed("run-a", START + offset));

        expect(records()).toEqual([{ runId: "run-a", outcome: "stopped" }]);
      },
    );

    it("a_killed_run_leaves_every_other_runs_open_record_alone", () => {
      const { repository, root, records } = make();

      repository.open(root, START, "tester", ["scan"], "run-a");
      repository.open(root, START + 1000, "tester", ["scan"], "run-b");
      repository.settleKilled(root, killed("run-b", START + 1000));

      const byId = () =>
        Object.fromEntries(records().map((one) => [one.runId, one.outcome]));

      expect(records()).toHaveLength(2);
      expect(byId()).toEqual({ "run-a": "running", "run-b": "stopped" });

      repository.settleKilled(root, killed("run-c", START + 2000));

      expect(records()).toHaveLength(3);
      expect(byId()).toEqual({
        "run-a": "running",
        "run-b": "stopped",
        "run-c": "stopped",
      });
    });

    it("settling_the_same_killed_run_twice_leaves_one_stopped_record", () => {
      const { repository, root, records } = make();

      repository.open(root, START, "tester", ["scan"], "run-a");
      repository.settleKilled(root, killed("run-a", START + 60_000));
      repository.settleKilled(root, killed("run-a", START + 60_000));

      expect(records()).toEqual([{ runId: "run-a", outcome: "stopped" }]);
    });
  });
}

suite("Run log contract (fake)", () => {
  const repository = new FakeRunLogRepository();

  return {
    repository,
    root: "/work/repository",
    records: () =>
      repository.records.map((one) => ({
        runId: one.runId,
        outcome: one.outcome,
      })),
  };
});

suite("Run log contract (real adapter)", () => {
  const root = makeTempDir("run-log-contract-");

  return {
    repository: new RunLogAdapter(nodeIo()),
    root,
    records: () => {
      const directory = logDirectory(root);

      try {
        return readdirSync(directory)
          .filter((name) => name.endsWith("-scan.json"))
          .sort()
          .map((name) => {
            const record = validateRunRecord(
              JSON.parse(readFileSync(join(directory, name), "utf8")),
            );

            return { runId: record.run_id, outcome: record.outcome };
          });
      } catch {
        return [];
      }
    },
  };
});
