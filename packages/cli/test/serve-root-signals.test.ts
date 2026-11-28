import { afterEach, describe, expect, it, vi } from "vitest";
import { plantMarkerIn, typescriptScenario } from "./support/index.js";
import { SENT_SIGNALS } from "./support/serve-root.js";

describe("the in-process serve root's stop signals", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    SENT_SIGNALS.length = 0;
  });

  it("a_stop_by_repository_of_an_app_run_signals_no_real_process", async () => {
    const kill = vi.spyOn(process, "kill");
    const { root, repository } = typescriptScenario();
    const other = root.io.pid() + 1;

    root.io.alive.add(other);
    plantMarkerIn(root.io.files, repository, {
      pid: other,
      pgid: other,
      started_by: "app",
      started_at: new Date().toISOString(),
    });

    await root.call("scan.stop", { repository, owner: "app" });

    expect(SENT_SIGNALS).toEqual([`SIGTERM ${-other}`]);
    expect(kill.mock.calls.filter(([, name]) => name !== 0)).toEqual([]);

    await root.close();
  });

  it("a_stop_by_repository_never_signals_a_marker_pid_that_sits_in_another_group", async () => {
    const { root, repository } = typescriptScenario();
    const runner = root.io.pid() + 1;

    root.io.alive.add(runner);
    root.io.groups.set(runner, root.io.pid() + 2);
    plantMarkerIn(root.io.files, repository, {
      pid: runner,
      pgid: runner,
      started_by: "app",
      started_at: new Date().toISOString(),
    });

    await root.call("scan.stop", { repository, owner: "app" });

    expect(SENT_SIGNALS).toEqual([]);

    await root.close();
  });

  it("a_stop_by_repository_never_signals_the_group_the_service_itself_runs_in", async () => {
    const { root, repository } = typescriptScenario();
    const runner = root.io.pid() + 1;

    root.io.alive.add(runner);
    root.io.groups.set(runner, runner);
    root.io.groups.set(root.io.pid(), runner);
    plantMarkerIn(root.io.files, repository, {
      pid: runner,
      pgid: runner,
      started_by: "app",
      started_at: new Date().toISOString(),
    });

    await root.call("scan.stop", { repository, owner: "app" });

    expect(SENT_SIGNALS).toEqual([]);

    await root.close();
  });
});
