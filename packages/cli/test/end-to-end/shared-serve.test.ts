import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../../tools/scripts/pool-scale.mjs";
import {
  hold,
  pidFile,
  plantMarker,
  sharedGates,
  sharedServe,
  typescriptRepository,
} from "../serve-harness.js";

const TIMEOUT = scaledTimeout(60_000);

const START = { describe: false, analysis: false, sense: [] };

describe("the shared service", () => {
  it(
    "sharedServe_returns_the_same_service_until_it_exits",
    async () => {
      const first = await sharedServe();
      const again = await sharedServe();

      expect(again.child.pid).toBe(first.child.pid);

      first.child.kill("SIGKILL");
      await first.exited;

      const next = await sharedServe();

      expect(next.child.pid).not.toBe(first.child.pid);
      expect(next.child.exitCode).toBeNull();
    },
    TIMEOUT,
  );

  let left: string | undefined;

  it(
    "the_afterEach_leaves_a_scan_it_started_stopped",
    async () => {
      const serve = await sharedServe();
      const repository = typescriptRepository();

      hold(repository);
      await serve.call("scan.start", { repository, ...START });
      await pidFile(serve, sharedGates(), repository);

      expect(
        existsSync(join(sharedGates(), `${basename(repository)}.pid`)),
      ).toBe(true);

      left = repository;
    },
    TIMEOUT,
  );

  it(
    "the_afterEach_leaves_no_scan_running",
    async () => {
      const serve = await sharedServe();

      expect(left).toBeDefined();
      expect(
        (await serve.call("scan.status", { repository: left as string })).ok
          .running,
      ).toBe(false);
    },
    TIMEOUT,
  );

  it(
    "a_hold_file_holds_only_its_own_repository",
    async () => {
      const serve = await sharedServe();
      const held = typescriptRepository();
      const free = typescriptRepository();

      hold(held);

      await serve.call("scan.start", { repository: held, ...START });

      const started = await serve.call("scan.start", {
        repository: free,
        ...START,
      });

      expect(await serve.outcome(started.ok)).toEqual({ status: "finished" });
      expect(
        (await serve.call("scan.status", { repository: held })).ok.running,
      ).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "scan_status_answers_each_repository_by_its_own_marker",
    async () => {
      const serve = await sharedServe();
      const marked = typescriptRepository();
      const bare = typescriptRepository();

      plantMarker(marked, {
        pid: process.pid,
        pgid: process.pid,
        started_by: "cli",
      });

      expect(
        (await serve.call("scan.status", { repository: marked })).ok.running,
      ).toBe(true);
      expect(
        (await serve.call("scan.status", { repository: bare })).ok.running,
      ).toBe(false);
    },
    TIMEOUT,
  );
});
