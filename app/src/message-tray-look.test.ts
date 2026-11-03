import { beforeAll, describe, expect, it } from "vitest";
import { chrome, collectFacts, here } from "./look-page";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
window.__TAURI_INTERNALS__ = { invoke: async () => "0.0.0" };
import { buildFooter } from ${JSON.stringify(here("footer-view.ts"))};

const footer = document.getElementById("footer");
const view = buildFooter(footer);
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const q = (selector) => footer.querySelector(selector);
const all = (selector) => [...footer.querySelectorAll(selector)];
const rect = (node) => node.getBoundingClientRect();
const facts = {};

view.setCount("6 of 46 modules on the canvas");
view.setScan({ origin: { branch: "main", commit: "a1b2c3d" }, scannedAt: Date.now(), changes: { files: [], moved: null }, progress: null, canShow: false, log: null });

facts.children = [...footer.children].slice(0, 6).map((node) => node.className.split(" ")[0]);
facts.absent = [".notice", ".agent-line", ".tools-notice"].map((selector) => all(selector).length);
const bellSvg = q(".bell svg");
facts.bell = {
  width: bellSvg.getBoundingClientRect().width,
  height: bellSvg.getBoundingClientRect().height,
  paths: [...bellSvg.querySelectorAll("path")].map((p) => p.getAttribute("d")),
  label: q(".bell").getAttribute("aria-label"),
};
facts.emptyBadgeHidden = q(".bell-badge").hidden;

view.post({ kind: "warning", text: "The recognizer command is older" });
facts.badgeWarning = { text: q(".bell-badge").textContent, hidden: q(".bell-badge").hidden, quiet: q(".bell-badge").classList.contains("quiet"), background: getComputedStyle(q(".bell-badge")).backgroundColor };
facts.toast = { hidden: q(".message-toast").hidden, text: q(".message-toast").textContent, role: q(".message-toast").getAttribute("role"), width: rect(q(".message-toast")).width, bottomAboveFooter: rect(q(".message-toast")).bottom <= rect(footer).top };

view.post({ kind: "done", text: "Saved overview", action: { label: "Undo", run: () => { facts.undone = true; } } });
view.post({ kind: "error", text: "alpha failed: boom" });
view.post({ kind: "info", text: "Describe wrote 440 lines, 0 modules failed." });
facts.iconColors = {};
const cs = (node) => getComputedStyle(node).color;
for (const kind of ["warning", "error", "done", "info"]) facts.iconColors[kind] = cs(q(".msg." + kind + " .msg-icon"));
facts.mutedColor = getComputedStyle(footer).color;
facts.toastReplaced = q(".message-toast").textContent;

click(q(".bell"));
const tray = q(".message-tray");
const tr = rect(tray);
const style = getComputedStyle(tray);
facts.tray = {
  hidden: tray.hidden,
  width: tr.width,
  maxHeight: style.maxHeight,
  overflowY: style.overflowY,
  radius: style.borderTopLeftRadius,
  shadow: style.boxShadow,
  aboveBell: tr.bottom <= rect(q(".bell")).top,
  rightGap: rect(footer).right - tr.right,
  title: q(".message-tray-title").textContent,
  clear: q(".message-clear").textContent,
  rows: all(".message-list .msg").map((row) => row.querySelector(".msg-text").textContent),
  whens: all(".message-list .msg .msg-when").map((n) => n.textContent),
};
facts.openState = { toastHidden: q(".message-toast").hidden, badge: q(".bell-badge").textContent, quiet: q(".bell-badge").classList.contains("quiet"), unreadRows: all(".msg.unread").length };
facts.cardsMatch = { trayFontSize: getComputedStyle(q(".message-list .msg")).fontSize, padding: getComputedStyle(q(".message-list .msg")).padding };

click(q(".message-list .msg.done .msg-act"));
facts.actionRan = facts.undone === true;

document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
facts.afterEscape = q(".message-tray").hidden;
facts.afterCloseUnread = all(".msg.unread").length;
facts.mutedBody = getComputedStyle(q(".message-list .msg .msg-body")).color;

click(q(".bell"));
click(document.body);
facts.afterOutside = q(".message-tray").hidden;

click(q(".bell"));
click(q(".message-tray-title"));
facts.insideStaysOpen = !q(".message-tray").hidden;
click(q(".message-clear"));
facts.cleared = { empty: q(".message-empty").textContent, badgeHidden: q(".bell-badge").hidden, rows: all(".message-list .msg").length };
document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

for (let i = 0; i < 12; i += 1) view.post({ kind: "done", text: "Message number " + i + " with enough words to be a real sentence about a thing" });
click(q(".bell"));
const long = q(".message-tray");
facts.scrolling = { height: rect(long).height, scrollHeight: long.scrollHeight, rows: all(".message-list .msg").length };

document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
`;

type Facts = ReturnType<typeof JSON.parse>;

const BELL_PATHS = [
  "M10.268 21a2 2 0 0 0 3.464 0",
  "M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326",
];

describe.skipIf(chrome === undefined)(
  "the footer bell and message tray",
  () => {
    let f = null as unknown as Facts;

    beforeAll(async () => {
      f = await collectFacts<Facts>(HARNESS, "message-tray-look");
    }, 180000);

    it("keeps identity, count, scan line, gap and bell in order and no notice spans", () => {
      expect(f.children).toEqual([
        "identity",
        "module-count",
        "scan-line",
        "metrics-line",
        "footer-gap",
        "bell",
      ]);
      expect(f.absent).toEqual([0, 0, 0]);
    });

    it("draws the mock's 16 px bell with a labelled button", () => {
      expect(f.bell.width).toBe(16);
      expect(f.bell.height).toBe(16);
      expect(f.bell.paths).toEqual(BELL_PATHS);
      expect(f.bell.label).toBe("Messages");
      expect(f.emptyBadgeHidden).toBe(true);
    });

    it("shows an amber badge for an unread warning", () => {
      expect(f.badgeWarning.text).toBe("1");
      expect(f.badgeWarning.hidden).toBe(false);
      expect(f.badgeWarning.quiet).toBe(false);
      expect(f.badgeWarning.background).toBe("rgb(191, 135, 0)");
    });

    it("toasts a new message above the footer with a status role, replaced by the next", () => {
      expect(f.toast.hidden).toBe(false);
      expect(f.toast.text).toContain("The recognizer command is older");
      expect(f.toast.role).toBe("status");
      expect(f.toast.bottomAboveFooter).toBe(true);
      expect(f.toastReplaced).toContain("Describe wrote 440 lines");
    });

    it("colours the kind icons amber, red, green and muted", () => {
      expect(f.iconColors.warning).toBe("rgb(191, 135, 0)");
      expect(f.iconColors.error).toBe("rgb(207, 34, 46)");
      expect(f.iconColors.done).toBe("rgb(26, 127, 55)");
      expect(f.iconColors.info).toBe(f.mutedColor);
    });

    it("opens a 380 px wide tray above the bell that scrolls up to 380 px tall", () => {
      expect(f.tray.hidden).toBe(false);
      expect(f.tray.width).toBe(380);
      expect(f.tray.maxHeight).toBe("380px");
      expect(f.tray.overflowY).toBe("auto");
      expect(f.tray.radius).toBe("9px");
      expect(f.tray.shadow).toContain("rgba(0, 0, 0, 0.5) 0px 10px 30px 0px");
      expect(f.tray.aboveBell).toBe(true);
      expect(Math.abs(f.tray.rightGap - 10)).toBeLessThanOrEqual(10);
    });

    it("heads the tray Messages with a Clear link and lists rows newest first with times", () => {
      expect(f.tray.title).toBe("Messages");
      expect(f.tray.clear).toBe("Clear");
      expect(f.tray.rows[0]).toContain("Describe wrote 440 lines");
      expect(f.tray.rows).toHaveLength(4);
      expect(f.tray.whens).toEqual([
        "just now",
        "just now",
        "just now",
        "just now",
      ]);
    });

    it("marks everything read on open: toast hidden, grey total badge, rows keep unread text", () => {
      expect(f.openState.toastHidden).toBe(true);
      expect(f.openState.badge).toBe("4");
      expect(f.openState.quiet).toBe(true);
      expect(f.openState.unreadRows).toBe(4);
    });

    it("draws the toast and the tray rows from the same card", () => {
      expect(f.cardsMatch.trayFontSize).toBe("13px");
      expect(f.cardsMatch.padding).toBe("10px 14px");
    });

    it("runs a row's action when clicked", () => {
      expect(f.actionRan).toBe(true);
    });

    it("closes on Escape and goes muted once read", () => {
      expect(f.afterEscape).toBe(true);
      expect(f.afterCloseUnread).toBe(0);
      expect(f.mutedBody).toBe(f.mutedColor);
    });

    it("closes on an outside click but not on a click inside", () => {
      expect(f.afterOutside).toBe(true);
      expect(f.insideStaysOpen).toBe(true);
    });

    it("clears to the empty state and hides the badge", () => {
      expect(f.cleared).toEqual({
        empty: "Nothing to report",
        badgeHidden: true,
        rows: 0,
      });
    });

    it("scrolls at 380 px tall with twelve rows", () => {
      expect(f.scrolling.rows).toBe(12);
      expect(f.scrolling.height).toBe(380);
      expect(f.scrolling.scrollHeight).toBeGreaterThan(380);
    });
  },
);
