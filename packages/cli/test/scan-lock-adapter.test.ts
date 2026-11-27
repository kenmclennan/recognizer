import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { ScanLockAdapter } from "../src/adapters/filesystem/scan-lock-adapter.js";
import { nodeIo } from "../src/cli.js";
import { markerPath, parseMarker } from "../src/scan-marker.js";

describe("scan lock adapter", () => {
  it("the_held_lock_reports_the_start_the_marker_records", () => {
    const root = makeTempDir("scan-lock-start-");
    const io = { ...nodeIo(), now: () => 1_764_211_131_494 };
    const acquired = new ScanLockAdapter(io).acquire(root, {
      sensors: [],
      describe: false,
    });

    expect(acquired.ok).toBe(true);

    if (!acquired.ok) {
      return;
    }

    const marker = parseMarker(readFileSync(markerPath(root), "utf8"));

    expect(acquired.lock.startedAt).toBe(Date.parse(marker?.started_at ?? ""));
    expect(new Date(acquired.lock.startedAt).toISOString()).toBe(
      marker?.started_at,
    );

    acquired.lock.release();
  });

  it("the_held_lock_reports_the_run_the_marker_records", () => {
    const root = makeTempDir("scan-lock-run-");
    const acquired = new ScanLockAdapter(nodeIo()).acquire(root, {
      sensors: [],
      describe: false,
    });

    expect(acquired.ok).toBe(true);

    if (!acquired.ok) {
      return;
    }

    const marker = parseMarker(readFileSync(markerPath(root), "utf8"));

    expect(marker?.run_id).toBeTruthy();
    expect(acquired.lock.runId).toBe(marker?.run_id);

    acquired.lock.release();
  });
});
