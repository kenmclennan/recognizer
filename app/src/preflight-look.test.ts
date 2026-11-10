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
const py = { id: "crap:python:sensors:environment", line: "coverage and pytest are not installed", needs: ["crap"], project: { language: "python", directory: "sensors" }, fix: { text: "uv sync", command: ["uv", "sync"], cwd: "sensors", env: {}, kind: "repository" } };
const rust = { id: "mutation:rust:root:cargo", line: "cargo-llvm-cov is not installed", needs: ["mutation"], project: null, fix: { text: "cargo install cargo-llvm-cov", command: null, cwd: "", env: {}, kind: "outside" } };
const calls = { fix: [], installed: [], copy: [], run: 0 };
const view = buildScanPanelView({
  tick() {}, setOnlyView() {}, setMode() {}, stop() {}, answerDescribe() {}, clearReport() {}, openLog() {},
  run: () => { calls.run += 1; },
  copy: (text) => calls.copy.push(text),
  fix: (id) => calls.fix.push(id),
  installed: (id) => calls.installed.push(id),
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
  title: q(".preflight-box-title")?.textContent ?? null,
  button: q(".scan-run")?.textContent ?? null,
  disabled: q(".scan-run")?.disabled ?? null,
  gaps: all(".preflight-gap").map((g) => ({ line: g.querySelector(".preflight-gap-line").textContent, where: g.querySelector(".preflight-gap-where").textContent, command: g.querySelector(".preflight-gap-command").textContent, buttons: [...g.querySelectorAll("button")].map((b) => b.textContent), fixed: g.querySelector(".preflight-gap-fixed")?.textContent ?? null, failure: g.querySelector(".preflight-gap-failure")?.textContent ?? null })),
  layout: q(".preflight-box") ? { box: box(q(".preflight-box")), run: box(q(".scan-run")), panel: box(view.element), controls: box(q(".scan-controls")) } : null,
});

(async () => {
  const facts = {};
  const open = (gap) => ({ gap, fixed: false, failure: null });

  render({ state: "running", gaps: [] }, true);
  facts.running = snapshot();

  render({ state: "gaps", gaps: [open(py), open(rust)] });
  facts.gaps = snapshot();

  q(".preflight-fix").click();
  q(".preflight-copy").click();
  q(".preflight-installed").click();
  facts.calls = { fix: calls.fix, copy: calls.copy, installed: calls.installed };

  render({ state: "gaps", gaps: [{ gap: py, fixed: true, failure: null }, open(rust)] });
  facts.oneFixed = snapshot();

  render({ state: "gaps", gaps: [{ gap: py, fixed: true, failure: null }, { gap: rust, fixed: true, failure: null }] });
  facts.allFixed = snapshot();
  q(".scan-run").click();
  facts.calls.run = calls.run;

  render({ state: "gaps", gaps: [{ gap: py, fixed: false, failure: "uv: no network" }, open(rust)] });
  facts.failed = snapshot();

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

  it("lists each gap with its sensor and project, and the count", () => {
    expect(f.gaps.head).toBe("Nothing ran");
    expect(f.gaps.line).toBe(
      "Some tools the ticked sensors need are missing. Fix them below, then scan.",
    );
    expect(f.gaps.title).toBe("Before this scan can run");
    expect(f.gaps.count).toBe("2 of 2 left");
    expect(f.gaps.gaps.map((g: Facts) => [g.line, g.where])).toEqual([
      [
        "coverage and pytest are not installed",
        "C.R.A.P. · Python project sensors/",
      ],
      ["cargo-llvm-cov is not installed", "Mutation"],
    ]);
  });

  it("gives a repository fix a Fix button and an outside fix Copy and I've installed it", () => {
    expect(f.gaps.gaps[0].buttons).toEqual(["Fix"]);
    expect(f.gaps.gaps[1].buttons).toEqual(["Copy", "I've installed it"]);
    expect(f.calls.fix).toEqual(["crap:python:sensors:environment"]);
    expect(f.calls.copy).toEqual(["cargo install cargo-llvm-cov"]);
    expect(f.calls.installed).toEqual(["mutation:rust:root:cargo"]);
  });

  it("disables the button as N to fix before scanning, then offers Check again and run", () => {
    expect(f.gaps.button).toBe("2 to fix before scanning");
    expect(f.gaps.disabled).toBe(true);
    expect(f.oneFixed.count).toBe("1 of 2 left");
    expect(f.oneFixed.button).toBe("1 to fix before scanning");
    expect(f.oneFixed.gaps[0].fixed).toBe("Fixed");
    expect(f.oneFixed.gaps[0].buttons).toEqual([]);
    expect(f.allFixed.button).toBe("Check again and run");
    expect(f.allFixed.disabled).toBe(false);
    expect(f.calls.run).toBe(1);
  });

  it("puts the box above a full-width button inside the panel", () => {
    const { box, run, panel } = f.gaps.layout;

    expect(box.bottom).toBeLessThanOrEqual(run.top);
    expect(Math.abs(run.width - box.width)).toBeLessThanOrEqual(2);
    expect(run.left).toBeGreaterThanOrEqual(panel.left);
    expect(run.right).toBeLessThanOrEqual(panel.right);
  });

  it("shows a failed Fix under the gap and nothing when idle", () => {
    expect(f.failed.gaps[0].failure).toBe("uv: no network");
    expect(f.idle.box).toBe(false);
    expect(f.idle.head).not.toBe("Nothing ran");
  });
});
