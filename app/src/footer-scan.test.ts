import { describe, expect, it } from "vitest";
import { ageText, NO_CHANGES, type ScanState, scanLine } from "./footer-scan";

const NOW = 1_000_000_000;

const state = (over: Partial<ScanState> = {}): ScanState => ({
  origin: { branch: "main", commit: "a1b2c3d" },
  scannedAt: NOW - 3 * 60000,
  changes: NO_CHANGES,
  scanning: null,
  ...over,
});

describe("scanLine", () => {
  it("says when the scan was taken, with the commit, and carries only its text, tone and files", () => {
    expect(scanLine(state(), NOW)).toMatchObject({
      kind: "up-to-date",
      text: "Scanned at a1b2c3d, 3 minutes ago",
      tone: "muted",
    });
    expect(Object.keys(scanLine(state(), NOW)).sort()).toEqual([
      "files",
      "kind",
      "text",
      "tone",
    ]);
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

  it("counts changed files in amber with the list", () => {
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

  it("shows the running text while a scan runs, ahead of any changes", () => {
    const line = scanLine(
      state({
        scanning: "Scanning\u2026 C.R.A.P., 1 of 2",
        changes: { files: [{ path: "a.py", kind: "added" }], moved: null },
      }),
      NOW,
    );

    expect(line).toEqual({
      kind: "scanning",
      text: "Scanning\u2026 C.R.A.P., 1 of 2",
      tone: "muted",
      files: [],
    });
  });

  it("reads Scanned once a scan has ended, whatever way it ended", () => {
    expect(scanLine(state({ scanning: null }), NOW)).toMatchObject({
      kind: "up-to-date",
      text: "Scanned at a1b2c3d, 3 minutes ago",
    });
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
