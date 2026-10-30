import { beforeAll, describe, expect, it } from "vitest";
import { chrome, collectFacts, here } from "./look-page";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { buildCanvasView } from ${JSON.stringify(here("canvas-view.ts"))};
import { createBusyGate } from ${JSON.stringify(here("busy-gate.ts"))};
import { spinner } from ${JSON.stringify(here("spinner-view.ts"))};

const facts = {};
const content = document.getElementById("content");
const tasks = new Map();
let now = 0;
let next = 0;
const timers = {
  set(callback, ms) { next += 1; tasks.set(next, { at: now + ms, callback }); return next; },
  clear(handle) { tasks.delete(handle); },
};
const advance = (ms) => {
  now += ms;
  for (const [id, task] of [...tasks]) if (task.at <= now) { tasks.delete(id); task.callback(); }
};
const state = (node) => {
  if (!node) return { present: false };
  const box = node.getBoundingClientRect();
  return { present: true, hidden: node.hidden, width: box.width, height: box.height, pointerEvents: getComputedStyle(node).pointerEvents, label: node.getAttribute("aria-label") };
};

const actions = {
  find() {}, select() {}, clear() {}, setShowInferred() {}, measure: (t) => t.length * 7,
  takeOff() {}, toggleFold() {}, openContents() {}, openInEditor() {}, toggleFocus() {}, openTab() {},
};
const canvas = buildCanvasView(actions);
canvas.element.style.flex = "1";
content.append(canvas.element);
const props = (over) => ({
  scene: null, selection: null, highlight: null, bar: null, titles: new Map(),
  open: 3, total: 5, showInferred: true, notice: null, ...over,
});
const busy = () => canvas.element.querySelector(".canvas-busy");

canvas.render(props({}));
facts.layoutIdle = state(busy());
canvas.render(props({ busy: true }));
facts.layoutBusy = state(busy());
facts.layoutSurfaceUnder = canvas.element.querySelector(".surface") !== null;
canvas.render(props({ busy: false }));
facts.layoutDone = state(busy());

content.replaceChildren();
const scanning = spinner("Scanning");
scanning.classList.add("scan-busy");
const gate = createBusyGate(() => content.replaceChildren(scanning), () => scanning.remove(), timers);
const end = gate.begin();
advance(199);
facts.scanBefore = state(content.querySelector(".spinner"));
advance(1);
facts.scanDuring = state(content.querySelector(".spinner"));
facts.scanAnimated = getComputedStyle(content.querySelector(".spinner-icon")).animationName;
facts.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
end();
facts.scanAfter = state(content.querySelector(".spinner"));

document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
`;

type Facts = ReturnType<typeof JSON.parse>;

describe.skipIf(chrome === undefined)("the spinner, in a real browser", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = await collectFacts<Facts>(HARNESS, "spinner-look");
  }, 180000);

  it("appears over the canvas during a slow layout and goes when it ends", () => {
    expect(f.layoutIdle.hidden).toBe(true);
    expect(f.layoutBusy.hidden).toBe(false);
    expect(f.layoutBusy.width).toBeGreaterThan(0);
    expect(f.layoutBusy.pointerEvents).toBe("none");
    expect(f.layoutBusy.label).toBe("Laying out");
    expect(f.layoutSurfaceUnder).toBe(true);
    expect(f.layoutDone.hidden).toBe(true);
  });

  it("appears while scanning only after 200ms and goes when the scan ends", () => {
    expect(f.scanBefore.present).toBe(false);
    expect(f.scanDuring.present).toBe(true);
    expect(f.scanDuring.width).toBeGreaterThan(0);
    expect(f.scanDuring.label).toBe("Scanning");
    expect(f.scanAnimated).toBe(f.reducedMotion ? "none" : "spinner-turn");
    expect(f.scanAfter.present).toBe(false);
  });
});
