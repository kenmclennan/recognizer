import { describe, expect, it } from "vitest";
import { ageText, NO_CHANGES, type ScanState, scanLine } from "./footer-scan";

const NOW = 1_000_000_000;

const state = (over: Partial<ScanState> = {}): ScanState => ({
  origin: { branch: "main", commit: "a1b2c3d" },
  scannedAt: NOW - 3 * 60000,
  changes: NO_CHANGES,
  progress: null,
  canShow: false,
  log: null,
  ...over,
});

describe("scanLine", () => {
  it("says when the scan was taken, with the commit, and offers no button", () => {
    expect(scanLine(state(), NOW)).toMatchObject({
      kind: "up-to-date",
      text: "Scanned at a1b2c3d, 3 minutes ago",
      tone: "muted",
      rescan: "none",
    });
  });

  it("leaves the commit out outside git", () => {
    const line = scanLine(
      state({ origin: { branch: null, commit: null } }),
      NOW,
    );

    expect(line.text).toBe("Scanned 3 minutes ago");
  });

  it("says just now under a minute", () => {
    expect(scanLine(state({ scannedAt: NOW - 20000 }), NOW).text).toBe(
      "Scanned at a1b2c3d, just now",
    );
  });

  it("counts changed files in amber with the list and a Rescan button", () => {
    const files = [
      { path: "a.py", kind: "modified" as const },
      { path: "b.py", kind: "added" as const },
      { path: "c.py", kind: "deleted" as const },
    ];
    const line = scanLine(state({ changes: { files, moved: null } }), NOW);

    expect(line).toMatchObject({
      kind: "files",
      text: "3 files changed since",
      tone: "amber",
      files,
      rescan: "enabled",
    });
  });

  it("uses the singular for one file", () => {
    const line = scanLine(
      state({
        changes: { files: [{ path: "a.py", kind: "added" }], moved: null },
      }),
      NOW,
    );

    expect(line.text).toBe("1 file changed since");
  });

  it("replaces the count with the moved text and offers no list", () => {
    const line = scanLine(
      state({
        changes: {
          files: [{ path: "a.py", kind: "added" }],
          moved: { branch: "main", commit: "9f8e7d6" },
        },
      }),
      NOW,
    );

    expect(line).toMatchObject({
      kind: "moved",
      text: "Now on main at 9f8e7d6",
      tone: "amber",
      files: [],
      rescan: "enabled",
    });
  });

  it("words a detached head without a branch", () => {
    const line = scanLine(
      state({
        changes: { files: [], moved: { branch: null, commit: "9f8e7d6" } },
      }),
      NOW,
    );

    expect(line.text).toBe("Now at 9f8e7d6");
  });

  it("shows the phase text with Stop and a disabled Rescan while a scan runs", () => {
    const line = scanLine(
      state({
        progress: {
          text: "Describing 1 of 2",
          running: true,
          failed: 0,
          tone: "muted",
        },
        changes: { files: [{ path: "a.py", kind: "added" }], moved: null },
      }),
      NOW,
    );

    expect(line).toMatchObject({
      kind: "scanning",
      text: "Describing 1 of 2",
      tone: "muted",
      rescan: "disabled",
      stop: true,
      show: false,
      openLog: false,
    });
  });

  it("shows the result after a scan, with Show and Open log only for a failure", () => {
    const done = {
      text: "Scan done - extracted",
      running: false,
      failed: 0,
      tone: "muted" as const,
    };
    const failed = {
      text: "2 failed",
      running: false,
      failed: 2,
      tone: "amber" as const,
    };

    expect(scanLine(state({ progress: done }), NOW)).toMatchObject({
      kind: "result",
      text: "Scan done - extracted",
      rescan: "enabled",
      stop: false,
      show: false,
      openLog: false,
    });
    expect(
      scanLine(state({ progress: failed, canShow: true, log: "l.json" }), NOW),
    ).toMatchObject({
      kind: "result",
      tone: "amber",
      show: true,
      openLog: true,
    });
    expect(scanLine(state({ progress: failed }), NOW)).toMatchObject({
      show: false,
      openLog: false,
    });
  });

  it("gives way to the changed-files line once the repository changes after a scan", () => {
    const line = scanLine(
      state({
        progress: {
          text: "Scan done - extracted",
          running: false,
          failed: 0,
          tone: "muted",
        },
        changes: { files: [{ path: "a.py", kind: "added" }], moved: null },
      }),
      NOW,
    );

    expect(line.kind).toBe("files");
  });
});

describe("ageText", () => {
  it("steps through minutes, hours and days", () => {
    expect(ageText(0, 60000)).toBe("1 minute ago");
    expect(ageText(0, 59 * 60000)).toBe("59 minutes ago");
    expect(ageText(0, 60 * 60000)).toBe("1 hour ago");
    expect(ageText(0, 25 * 3600000)).toBe("1 day ago");
    expect(ageText(0, 72 * 3600000)).toBe("3 days ago");
  });

  it("never goes negative", () => {
    expect(ageText(5000, 0)).toBe("just now");
  });
});
