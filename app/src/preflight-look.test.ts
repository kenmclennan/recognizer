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
const calls = { run: 0 };
const view = buildScanPanelView({
  tick() {}, setOnlyView() {}, setMode() {}, stop() {}, answerDescribe() {}, clearReport() {}, openLog() {},
  run: () => { calls.run += 1; },
  copy() {},
});
const host = document.createElement("div");
host.style.cssText = "width:360px;display:flex;flex-direction:column";
host.append(view.element);
document.body.append(host);

function render(preflight, scanning = false) {
  const model = scanPanel({
    scan: null, config: null, sensors: [], lines: { modules: [], of: () => ({ kind: "missing" }) },
    describedAt: null, ticks: { describe: false, ticked: [], once: ["crap", "mutation"], onlyView: false },
    run: NO_RUN, scanning, now: 0, shipped: SHIPPED, preflight,
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
  order: [...(q(".scan-preflight")?.parentNode?.children ?? [])].map((c) => c.className.split(" ")[0]),
  panelOrder: [...(q(".scan-preflight")?.children ?? [])].map((c) => c.className),
  help: all(".preflight-help").map((h) => ({ sensor: h.dataset.sensor, text: h.textContent, code: h.querySelector("code")?.textContent ?? null })),
  title: q(".preflight-box-title")?.textContent ?? null,
  button: q(".scan-run")?.textContent ?? null,
  disabled: q(".scan-run")?.disabled ?? null,
  gaps: all(".preflight-gap").map((g) => ({ line: g.querySelector(".preflight-gap-line").textContent, where: g.querySelector(".preflight-gap-where").textContent })),
  layout: q(".preflight-box") ? { box: box(q(".preflight-box")), run: box(q(".scan-run")), panel: box(view.element), controls: box(q(".scan-controls")) } : null,
});

(async () => {
  const facts = {};
  render({ state: "running", gaps: [] }, true);
  facts.running = snapshot();

  render({ state: "gaps", gaps: [py, py2, rust] });
  facts.gaps = snapshot();
  q(".scan-run").click();
  facts.calls = { run: calls.run };

  render({ state: "idle", gaps: [] });
  facts.idle = { box: q(".preflight-box") !== null, head: q(".summary-head")?.textContent ?? null };

  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Facts = ReturnType<typeof JSON.parse>;

describe.skipIf(webkit === undefined)("the preflight panel", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = await collectFacts<Facts>(HARNESS, "preflight-look", "bare");
  }, scaledTimeout(120000));

  it("reads Running pre-flight checks on the card and a disabled button while it runs", () => {
    expect(f.running.head).toBe("Running pre-flight checks");
    expect(f.running.button).toBe("Running pre-flight checks");
    expect(f.running.disabled).toBe(true);
    expect(f.running.gaps).toEqual([]);
  });

  it("lists each gap with its sensor and no count", () => {
    expect(f.gaps.head).toBe("Nothing ran");
    expect(f.gaps.line).toBe(
      "Some tools the ticked sensors need are missing. Set them up as below, then scan again.",
    );
    expect(f.gaps.title).toBe("Before this scan can run");
    expect(f.gaps.count).toBeNull();
    expect(f.gaps.gaps.map((g: Facts) => [g.line, g.where])).toEqual([
      ["coverage and pytest are not installed", "C.R.A.P."],
      ["no test suites are configured", "C.R.A.P."],
      ["cargo-llvm-cov is not installed", "Mutation"],
    ]);
  });

  it("offers no Fix, Copy or installed control on any gap", () => {
    expect(f.gaps.controls).toBe(0);
  });

  it("offers Check again and run, enabled, when gaps are listed", () => {
    expect(f.gaps.button).toBe("Check again and run");
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

  it("puts the box above a full-width button inside the panel", () => {
    const { box, run, panel } = f.gaps.layout;

    expect(f.gaps.panelOrder).toEqual([
      "preflight-box",
      "preflight-help",
      "preflight-help",
    ]);
    expect(f.gaps.order.indexOf("scan-preflight")).toBeLessThan(
      f.gaps.order.indexOf("scan-buttons"),
    );
    expect(box.bottom).toBeLessThanOrEqual(run.top);
    expect(Math.abs(run.width - box.width)).toBeLessThanOrEqual(2);
    expect(run.left).toBeGreaterThanOrEqual(panel.left);
    expect(run.right).toBeLessThanOrEqual(panel.right);
  });

  it("shows nothing when idle", () => {
    expect(f.idle.box).toBe(false);
    expect(f.idle.head).not.toBe("Nothing ran");
  });
});
