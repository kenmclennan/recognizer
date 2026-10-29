import { beforeAll, describe, expect, it } from "vitest";
import { chrome, collectFacts, here } from "./look-page";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
window.__TAURI_INTERNALS__ = { invoke: async () => "0.0.0" };
import { buildFooter } from ${JSON.stringify(here("footer-view.ts"))};

const footer = document.getElementById("footer");
let rescans = 0;
const view = buildFooter(footer, () => { rescans += 1; });
const NOW = Date.now();
const origin = { branch: "main", commit: "a1b2c3d" };
const base = { origin, scannedAt: NOW - 3 * 60000, changes: { files: [], moved: null }, rescanning: false };
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const q = (selector) => footer.querySelector(selector);
const rows = () => [...footer.querySelectorAll(".changes-row")].map((row) => [...row.children].map((c) => c.textContent));
const buttons = () => [...footer.querySelectorAll(".scan-line button")].map((b) => ({ text: b.textContent, disabled: b.disabled }));
const shape = () => ({
  text: q(".scan-line").textContent,
  amber: q(".scan-line").classList.contains("amber"),
  color: getComputedStyle(q(".scan-line")).color,
  buttons: buttons(),
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
click(q(".scan-count"));
click(q(".rescan-button"));
facts.rescans = rescans;

view.setScan({ ...base, changes: { files, moved: { branch: "main", commit: "9f8e7d6" } } });
facts.moved = { ...shape(), count: footer.querySelectorAll(".scan-count").length };
view.setScan({ ...base, changes: { files: [], moved: { branch: null, commit: "9f8e7d6" } } });
facts.detached = shape().text;

view.setScan({ ...base, rescanning: true, changes: { files, moved: null } });
facts.rescanning = shape();

view.setScan({ ...base, origin: { branch: null, commit: null } });
facts.noGit = shape().text;

document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
`;

type Facts = ReturnType<typeof JSON.parse>;

describe.skipIf(chrome === undefined)("the footer's scan line", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = await collectFacts<Facts>(HARNESS, "footer-look");
  }, 180000);

  it("is muted with no button when the scan is up to date", () => {
    expect(f.upToDate.text).toBe("Scanned at a1b2c3d, 3 minutes ago");
    expect(f.upToDate.amber).toBe(false);
    expect(f.upToDate.buttons).toEqual([]);
    expect(f.upToDate.color).toBe(f.mutedColor);
  });

  it("is amber with a count button and a Rescan button when files changed", () => {
    expect(f.changed.text).toBe("3 files changed sinceRescan");
    expect(f.changed.amber).toBe(true);
    expect(f.changed.color).not.toBe(f.mutedColor);
    expect(f.changed.buttons).toEqual([
      { text: "3 files changed since", disabled: false },
      { text: "Rescan", disabled: false },
    ]);
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

  it("runs a rescan from the footer button", () => {
    expect(f.rescans).toBe(1);
  });

  it("shows where the branch or commit moved, amber, with no list", () => {
    expect(f.moved.text).toBe("Now on main at 9f8e7d6Rescan");
    expect(f.moved.amber).toBe(true);
    expect(f.moved.count).toBe(0);
    expect(f.moved.buttons).toEqual([{ text: "Rescan", disabled: false }]);
    expect(f.moved.listHidden).toBe(true);
    expect(f.detached).toBe("Now at 9f8e7d6Rescan");
  });

  it("shows Rescanning... muted with a disabled Rescan button", () => {
    expect(f.rescanning.text).toBe("Rescanning...Rescan");
    expect(f.rescanning.amber).toBe(false);
    expect(f.rescanning.buttons).toEqual([{ text: "Rescan", disabled: true }]);
    expect(f.rescanning.listHidden).toBe(true);
  });

  it("gives no commit outside git", () => {
    expect(f.noGit).toBe("Scanned 3 minutes ago");
  });
});
