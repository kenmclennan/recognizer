import { beforeAll, describe, expect, it } from "vitest";
import { chrome, collectFacts, here } from "./look-page";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
window.__TAURI_INTERNALS__ = { invoke: async () => "0.0.0" };
import { buildFooter } from ${JSON.stringify(here("footer-view.ts"))};

const footer = document.getElementById("footer");
const view = buildFooter(footer);
const NOW = Date.now();
const origin = { branch: "main", commit: "a1b2c3d" };
const base = { origin, scannedAt: NOW - 3 * 60000, changes: { files: [], moved: null }, scanning: null };
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const q = (selector) => footer.querySelector(selector);
const rows = () => [...footer.querySelectorAll(".changes-row")].map((row) => [...row.children].map((c) => c.textContent));
const buttons = () => [...footer.querySelectorAll("button")].filter((b) => !b.closest(".message-tray, .message-toast")).map((b) => b.className);
const removed = () => footer.querySelectorAll(".rescan-button, .scan-stop, .scan-show, .scan-open-log, .scan-dot").length;
const shape = () => ({
  text: q(".scan-line").textContent,
  amber: q(".scan-line").classList.contains("amber"),
  color: getComputedStyle(q(".scan-line")).color,
  buttons: buttons(),
  removed: removed(),
  listHidden: q(".changes-list").hidden,
});
const facts = {};

view.setScan(base);
facts.upToDate = shape();
facts.mutedColor = getComputedStyle(footer).color;

const files = [
  { path: "app/a.py", kind: "modified" },
  { path: "app/new.py", kind: "added" },
  { path: "app/gone.py", kind: "deleted" },
];
view.setScan({ ...base, changes: { files, moved: null } });
facts.changed = shape();
click(q(".scan-count"));
facts.listOpen = { ...shape(), rows: rows(), expanded: q(".scan-count").getAttribute("aria-expanded") };
document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
facts.afterEscape = shape().listHidden;
click(q(".scan-count"));
click(document.body);
facts.afterOutside = shape().listHidden;
click(q(".scan-count"));
click(q(".changes-list"));
facts.afterInside = shape().listHidden;

view.setScan({ ...base, changes: { files, moved: { branch: "main", commit: "9f8e7d6" } } });
facts.moved = { ...shape(), count: footer.querySelectorAll(".scan-count").length };
view.setScan({ ...base, changes: { files: [], moved: { branch: null, commit: "9f8e7d6" } } });
facts.detached = shape().text;

view.setScan({ ...base, scanning: "Scanning\u2026 C.R.A.P., 1 of 2", changes: { files, moved: null } });
facts.scanning = shape();

view.setScan({ ...base, scanning: "Scanning\u2026" });
facts.scanningBare = shape();

view.setScan({ ...base });
facts.afterEnd = shape();

view.setScan({ ...base, origin: { branch: null, commit: null } });
facts.noGit = shape().text;

const metricsLine = () => { const node = q(".metrics-line"); return { text: node.textContent, hidden: node.hidden }; };
facts.metricsOff = metricsLine();
view.setMetrics("Showing complexity, coverage from crap");
facts.metricsOn = metricsLine();
view.setMetrics(null);
facts.metricsCleared = metricsLine();

document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
`;

type Facts = ReturnType<typeof JSON.parse>;

describe.skipIf(chrome === undefined)("the footer's scan line", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = await collectFacts<Facts>(HARNESS, "footer-look");
  }, 180000);

  it("shows the metrics line while a metric is ticked and clears it when none is", () => {
    expect(f.metricsOff.hidden).toBe(true);
    expect(f.metricsOn).toEqual({
      text: "Showing complexity, coverage from crap",
      hidden: false,
    });
    expect(f.metricsCleared).toEqual({ text: "", hidden: true });
  });

  it("is muted with only the bell as a button when the scan is up to date", () => {
    expect(f.upToDate.text).toBe("Scanned at a1b2c3d, 3 minutes ago");
    expect(f.upToDate.amber).toBe(false);
    expect(f.upToDate.buttons).toEqual(["bell"]);
    expect(f.upToDate.color).toBe(f.mutedColor);
  });

  it("is amber with the count button and the bell when files changed", () => {
    expect(f.changed.text).toBe("3 files changed since");
    expect(f.changed.amber).toBe(true);
    expect(f.changed.color).not.toBe(f.mutedColor);
    expect(f.changed.buttons).toEqual(["scan-count", "bell"]);
    expect(f.changed.listHidden).toBe(true);
  });

  it("opens the changed-file list with a row per file, and closes it on Escape or an outside click", () => {
    expect(f.listOpen.listHidden).toBe(false);
    expect(f.listOpen.expanded).toBe("true");
    expect(f.listOpen.rows).toEqual([
      ["modified", "app/a.py"],
      ["added", "app/new.py"],
      ["deleted", "app/gone.py"],
    ]);
    expect(f.afterEscape).toBe(true);
    expect(f.afterOutside).toBe(true);
    expect(f.afterInside).toBe(false);
  });

  it("shows where the branch or commit moved, amber, with no list", () => {
    expect(f.moved.text).toBe("Now on main at 9f8e7d6");
    expect(f.moved.amber).toBe(true);
    expect(f.moved.count).toBe(0);
    expect(f.moved.buttons).toEqual(["bell"]);
    expect(f.moved.listHidden).toBe(true);
    expect(f.detached).toBe("Now at 9f8e7d6");
  });

  it("shows the running line muted with only the bell while a scan runs", () => {
    expect(f.scanning.text).toBe("Scanning\u2026 C.R.A.P., 1 of 2");
    expect(f.scanning.amber).toBe(false);
    expect(f.scanning.buttons).toEqual(["bell"]);
    expect(f.scanning.listHidden).toBe(true);
    expect(f.scanningBare.text).toBe("Scanning\u2026");
  });

  it("reads Scanned again once the scan ends, with no button but the bell", () => {
    expect(f.afterEnd.text).toBe("Scanned at a1b2c3d, 3 minutes ago");
    expect(f.afterEnd.buttons).toEqual(["bell"]);
  });

  it("never draws Rescan, Stop, Show, Open log or a separator in any state", () => {
    for (const state of [
      f.upToDate,
      f.changed,
      f.moved,
      f.scanning,
      f.afterEnd,
    ]) {
      expect(state.removed).toBe(0);
    }
  });

  it("gives no commit outside git", () => {
    expect(f.noGit).toBe("Scanned 3 minutes ago");
  });
});
