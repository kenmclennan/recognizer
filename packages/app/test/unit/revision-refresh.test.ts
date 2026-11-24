import type { RepositoryState } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { refreshOnChange } from "../../src/revision-refresh";
import { snapshotOf } from "./repository-state-snapshot";

function feed() {
  const handlers = new Set<(state: RepositoryState) => void>();

  return {
    holder: {
      onRevision(handler: (state: RepositoryState) => void) {
        handlers.add(handler);

        return () => handlers.delete(handler);
      },
    },
    publish(state: RepositoryState) {
      for (const handler of handlers) {
        handler(state);
      }
    },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("refreshOnChange", () => {
  it("does not refresh for the first revision it sees", async () => {
    const { holder, publish } = feed();
    let refreshed = 0;

    refreshOnChange(holder, async () => {
      refreshed += 1;
    });
    publish(snapshotOf(1, ["crap"]));
    await tick();

    expect(refreshed).toBe(0);
  });

  it("refreshes when a freshness verdict changes and not when only the revision does", async () => {
    const { holder, publish } = feed();
    let refreshed = 0;

    refreshOnChange(holder, async () => {
      refreshed += 1;
    });
    publish(
      snapshotOf(1, ["crap"], {
        freshness: { crap: { state: "current", outOfDate: [] } },
      }),
    );
    publish(
      snapshotOf(2, ["crap"], {
        freshness: { crap: { state: "current", outOfDate: [] } },
      }),
    );
    await tick();

    expect(refreshed).toBe(0);

    publish(
      snapshotOf(3, ["crap"], {
        freshness: { crap: { state: "stale", outOfDate: ["a.test.ts"] } },
      }),
    );
    await tick();

    expect(refreshed).toBe(1);
  });

  it("refreshes when a registration change removes a sensor", async () => {
    const { holder, publish } = feed();
    let refreshed = 0;

    refreshOnChange(holder, async () => {
      refreshed += 1;
    });
    publish(snapshotOf(1, ["crap", "mutation"]));
    publish(snapshotOf(2, ["crap"]));
    await tick();

    expect(refreshed).toBe(1);
  });

  it("holds its refresh while a run is active and refreshes when it ends", async () => {
    const { holder, publish } = feed();
    let refreshed = 0;
    const running = {
      state: "running",
      plugins: [],
    } as unknown as RepositoryState["run"];

    refreshOnChange(holder, async () => {
      refreshed += 1;
    });
    publish(snapshotOf(1, ["crap"]));
    publish(
      snapshotOf(2, ["crap"], {
        run: running,
        results: { crap: { unreadable: 0, results: [] } },
      }),
    );
    await tick();

    expect(refreshed).toBe(0);

    publish(
      snapshotOf(3, ["crap"], {
        results: { crap: { unreadable: 0, results: [] } },
        inputsDigest: "e",
      }),
    );
    await tick();

    expect(refreshed).toBe(1);
  });
});
