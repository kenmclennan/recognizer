import { beforeAll, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../scripts/pool-scale.mjs";
import { collectFacts, here, webkit } from "../../src/look-page";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { openProgressModel, STOPPED_MODEL } from ${JSON.stringify(here("scan-open-model.ts"))};
import { showOpen } from ${JSON.stringify(here("scan-open-view.ts"))};
import { NO_PROGRESS } from ${JSON.stringify(here("scan-progress.ts"))};

const facts = {};
const content = document.getElementById("content");
const calls = { stop: 0, again: 0, log: 0 };
const view = showOpen(content, { stop: () => { calls.stop += 1; }, again: () => { calls.again += 1; }, openLog: () => { calls.log += 1; } });
const timing = (over) => ({ ...NO_PROGRESS.timing, ...over });
const ok = (name) => ({ name, outcome: "ok", reason: null, diagnosis: null });
const failed = (name) => ({ name, outcome: "failed", reason: "x", diagnosis: null });
const model = (progress, now) => openProgressModel({ folder: "recognizer", progress: { ...NO_PROGRESS, ...progress }, startedAt: 0, now, stopped: false });
const read = () => {
  const rows = [...content.querySelectorAll(".scan-row")].map((row) => {
    const state = row.querySelector(".scan-state");
    return { name: row.querySelector(".scan-row-name").textContent, classes: state.className, text: state.textContent.trim(), log: row.querySelector(".scan-log-link") !== null, spinning: row.querySelector(".scan-spin") !== null, icon: row.querySelector(".scan-icon") !== null };
  });
  const root = content.querySelector(".fo");
  const rootBox = root ? root.getBoundingClientRect() : null;
  const contentBox = content.getBoundingClientRect();
  return {
    title: content.querySelector(".fo-title")?.textContent,
    stage: content.querySelector(".fo-stage")?.textContent,
    indeterminate: content.querySelector(".fo-bar.indet") !== null,
    fill: content.querySelector(".fo-fill")?.style.width,
    counts: content.querySelector(".fo-counts")?.textContent,
    left: content.querySelector(".fo-left")?.textContent,
    elapsed: content.querySelector(".fo-elapsed")?.textContent,
    stop: content.querySelector(".fo-stop") !== null,
    again: content.querySelector(".fo-again-button") !== null,
    message: content.querySelector(".fo-msg")?.textContent,
    rows,
    fits: rootBox === null ? null : rootBox.left >= contentBox.left && rootBox.right <= contentBox.right,
    centred: rootBox === null ? null : Math.abs((rootBox.left + rootBox.right) / 2 - (contentBox.left + contentBox.right) / 2) < 2,
  };
};
const show = (progress, now) => { view.render(model(progress, now)); return read(); };

facts.starting = show({ extract: "run", languages: ["typescript", "python", "rust"] }, 1000);
const early = { extract: "run", languages: ["typescript", "python", "rust"], sensorProgress: { name: "typescript", phase: "extract", progress: { done: 280, total: 812, unit: "files" } }, timing: timing({ extractAt: { typescript: 0 }, extractTotals: { typescript: 812 } }) };
facts.early = show(early, 2000);
facts.mid = show({ extract: "run", languages: ["typescript", "python", "rust"], extractEntries: [ok("typescript")], sensorProgress: { name: "python", phase: "extract", progress: { done: 1240, total: 3812, unit: "files" } }, timing: timing({ extractAt: { typescript: 0, python: 6000 }, extractDoneAt: { typescript: 6000 }, extractTotals: { typescript: 812, python: 3812 } }) }, 19000);
facts.failed = show({ extract: "run", languages: ["typescript", "python", "rust"], log: "abc", extractEntries: [ok("typescript"), failed("python")], sensorProgress: { name: "rust", phase: "extract", progress: { done: 90, total: 214, unit: "files" } }, timing: timing({ extractAt: { typescript: 0, python: 6000, rust: 8000 }, extractDoneAt: { typescript: 6000, python: 8000 }, extractTotals: { typescript: 812, python: 3812, rust: 214 } }) }, 10000);
content.querySelector(".scan-log-link").click();
content.querySelector(".fo-stop").click();
facts.callsAfterRunning = { ...calls };
view.render(STOPPED_MODEL);
facts.stopped = read();
content.querySelector(".fo-again-button").click();
facts.callsAfterStopped = { ...calls };

document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
`;

type Facts = ReturnType<typeof JSON.parse>;

describe.skipIf(webkit === undefined)(
  "the first-open progress view, in a real browser",
  () => {
    let f = null as unknown as Facts;

    beforeAll(async () => {
      f = await collectFacts<Facts>(HARNESS, "scan-open-look");
    }, scaledTimeout(180000));

    it("starts with the finding stage and an indeterminate bar", () => {
      expect(f.starting.title).toBe("Scanning recognizer");
      expect(f.starting.stage).toBe("Finding the languages in this repository");
      expect(f.starting.indeterminate).toBe(true);
      expect(f.starting.rows.map((r: { text: string }) => r.text)).toEqual([
        "waiting",
        "waiting",
        "waiting",
      ]);
    });

    it("shows the running scanner's bar, count and row", () => {
      expect(f.early.stage).toBe("Reading Typescript files");
      expect(f.early.indeterminate).toBe(false);
      expect(f.early.fill).toBe("34%");
      expect(f.early.counts).toBe("280 of 812 files");
      expect(f.early.rows[0].classes).toContain("scan-state");
      expect(f.early.rows[0].classes).toContain("run");
      expect(f.early.rows[0].spinning).toBe(true);
    });

    it("shows done rows with a tick and time left only after 5 seconds", () => {
      expect(f.early.left).toBe("");
      expect(f.mid.rows[0].classes).toContain("ok");
      expect(f.mid.rows[0].icon).toBe(true);
      expect(f.mid.rows[0].text).toBe("812 files · 6s");
      expect(f.mid.left).toMatch(/left$/);
      expect(f.mid.rows[2].classes).toContain("muted");
    });

    it("marks a failed scanner bad with a log link while the others carry on", () => {
      expect(f.failed.rows[1].classes).toContain("bad");
      expect(f.failed.rows[1].text).toContain("failed");
      expect(f.failed.rows[1].log).toBe(true);
      expect(f.failed.rows[2].classes).toContain("run");
      expect(f.failed.stage).toBe("Reading Rust files");
    });

    it("keeps the view within its container and centred", () => {
      for (const state of [f.starting, f.early, f.mid, f.failed, f.stopped]) {
        expect(state.fits).toBe(true);
        expect(state.centred).toBe(true);
      }
    });

    it("calls the handed-in stop and log handlers", () => {
      expect(f.callsAfterRunning).toEqual({ stop: 1, again: 0, log: 1 });
    });

    it("offers Scan again only when stopped", () => {
      for (const state of [f.starting, f.early, f.mid, f.failed]) {
        expect(state.again).toBe(false);
        expect(state.stop).toBe(true);
      }

      expect(f.stopped.title).toBe("Scan stopped");
      expect(f.stopped.message).toBe(
        "Nothing is shown until a scan of this repository completes",
      );
      expect(f.stopped.again).toBe(true);
      expect(f.stopped.stop).toBe(false);
      expect(f.callsAfterStopped.again).toBe(1);
    });
  },
);
