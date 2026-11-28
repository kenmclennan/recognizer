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
});
