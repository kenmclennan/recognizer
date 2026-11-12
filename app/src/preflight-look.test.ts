import { beforeAll, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../scripts/pool-scale.mjs";
import { collectFacts, here, webkit } from "./look-page";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { scanPanel, NO_RUN } from ${JSON.stringify(here("scan-panel-model.ts"))};
import { buildScanPanelView } from ${JSON.stringify(here("scan-panel-view.ts"))};

const SHIPPED = {
  status: "ok",
  sensors: [
    { name: "crap", display: "C.R.A.P.", line: "Runs tests.", defaults: {}, runsTests: true, listed: true },
    { name: "mutation", display: "Mutation", line: "Mutates.", defaults: {}, runsTests: true, listed: true },
  ],
};
const py = { id: "crap:python:sensors:environment", line: "coverage and pytest are not installed", needs: ["crap"] };
const py2 = { id: "crap:config:no-suites", line: "no test suites are configured", needs: ["crap"] };
const rust = { id: "mutation:rust:root:cargo", line: "cargo-llvm-cov is not installed", needs: ["mutation"] };
const calls = { run: 0, stop: 0 };
import { NO_PROGRESS } from ${JSON.stringify(here("scan-progress.ts"))};
const view = buildScanPanelView({
  tick() {}, setOnlyView() {}, setMode() {}, stop() { calls.stop += 1; }, answerDescribe() {}, clearReport() {}, openLog() {}, openRunLog() {},
  run: () => { calls.run += 1; },
  copy() {},
});
const host = document.createElement("div");
host.style.cssText = "width:360px;display:flex;flex-direction:column";
host.append(view.element);
document.body.append(host);

const base = { version: 2, run_id: "r1", pid: 1, pgid: 1, started_at: "2026-11-12T09:00:00.000Z", started_by: "app", repository: "/r", sensors: ["crap", "mutation"], describe: false, ended_at: null, exit: null, gaps: [], failure: null };
function runView(over) {
  return over === null ? null : { record: { ...base, ...over }, progress: NO_PROGRESS, starting: null, adoptedAtOpen: null };
}
function render(over, scanning = false) {
  const model = scanPanel({
    scan: null, config: null, sensors: [], lines: { modules: [], of: () => ({ kind: "missing" }) },
    describedAt: null, ticks: { describe: false, ticked: [], once: ["crap", "mutation"], onlyView: false },
    run: NO_RUN, scanning, now: 0, shipped: SHIPPED, runView: runView(over),
  });
  view.render(model);
}
const q = (selector) => view.element.querySelector(selector);
const all = (selector) => [...view.element.querySelectorAll(selector)];
const box = (node) => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width }; };
const snapshot = () => ({
  head: q(".summary-head")?.textContent ?? null,
  line: q(".summary-line")?.textContent ?? null,
  count: q(".preflight-box-count")?.textContent ?? null,
  controls: all(".preflight-gap button, .preflight-gap code, .preflight-fix, .preflight-copy, .preflight-installed").length,
  help: all(".preflight-help").map((h) => ({ sensor: h.dataset.sensor, text: h.textContent, code: h.querySelector("code")?.textContent ?? null })),
  title: q(".preflight-box-title")?.textContent ?? null,
  button: q(".scan-run")?.textContent ?? null,
  disabled: q(".scan-run")?.disabled ?? null,
  stopButton: q(".scan-stop")?.textContent ?? null,
  runButtons: all(".scan-run").length,
  gaps: all(".preflight-gap").map((g) => ({ line: g.querySelector(".preflight-gap-line").textContent, where: g.querySelector(".preflight-gap-where").textContent })),
  layout: q(".summary") ? { card: box(q(".summary")), run: box(q(".scan-run") ?? q(".scan-stop")), panel: box(view.element) } : null,
});

(async () => {
  const facts = {};
  render({ phase: "checking" }, true);
  facts.running = snapshot();
  q(".scan-stop").click();
  facts.stopCalls = { stop: calls.stop };

  render({ phase: "refused", exit: 4, ended_at: "2026-11-12T09:00:01.000Z", gaps: [py, py2, rust] });
  facts.gaps = snapshot();
  q(".scan-run").click();
  facts.calls = { run: calls.run };

  render(null);
  facts.idle = { card: q(".summary[data-shape=run-card]") !== null, head: q(".summary-head")?.textContent ?? null };

  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Facts = ReturnType<typeof JSON.parse>;

describe.skipIf(webkit === undefined)("the preflight panel", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = await collectFacts<Facts>(HARNESS, "preflight-look", "bare");
  }, scaledTimeout(120000));

  it("reads Checking before the scan on the card and Stop as the only button", () => {
    expect(f.running.head).toBe("Checking before the scan");
    expect(f.running.stopButton).toBe("Stop");
    expect(f.running.runButtons).toBe(0);
    expect(f.running.gaps).toEqual([]);
    expect(f.stopCalls.stop).toBe(1);
  });

  it("lists each gap with its sensor and no count", () => {
    expect(f.gaps.head).toBe("Nothing ran");
    expect(f.gaps.line).toBe("Set these up, then scan again.");
    expect(f.gaps.count).toBeNull();
    expect(f.gaps.title).toBeNull();
    expect(f.gaps.gaps.map((g: Facts) => [g.line, g.where])).toEqual([
      ["coverage and pytest are not installed", "C.R.A.P."],
      ["no test suites are configured", "C.R.A.P."],
      ["cargo-llvm-cov is not installed", "Mutation"],
    ]);
  });

  it("offers no Fix, Copy or installed control on any gap", () => {
    expect(f.gaps.controls).toBe(0);
  });

  it("offers Check again and scan, enabled, on a refused card", () => {
    expect(f.gaps.button).toBe("Check again and scan");
    expect(f.gaps.disabled).toBe(false);
    expect(f.calls.run).toBe(1);
  });

  it("shows the help line under the box, one per reporting sensor", () => {
    expect(f.gaps.help).toEqual([
      {
        sensor: "crap",
        text: "To set this up with an agent: recognizer help sensors crap",
        code: "recognizer help sensors crap",
      },
      {
        sensor: "mutation",
        text: "To set this up with an agent: recognizer help sensors mutation",
        code: "recognizer help sensors mutation",
      },
    ]);
  });

  it("puts the run card above a full-width button inside the panel", () => {
    const { card, run, panel } = f.gaps.layout;

    expect(card.bottom).toBeLessThanOrEqual(run.top);
    expect(Math.abs(run.width - card.width)).toBeLessThanOrEqual(2);
    expect(run.left).toBeGreaterThanOrEqual(panel.left);
    expect(run.right).toBeLessThanOrEqual(panel.right);
  });

  it("shows nothing when idle", () => {
    expect(f.idle.card).toBe(false);
    expect(f.idle.head).not.toBe("Nothing ran");
  });
});
