import { describe, expect, it } from "vitest";
import { scaledTimeout } from "../../scripts/pool-scale.mjs";
import { collectFacts, here, webkit } from "./look-page";

const HOSTS = `<div style="display:flex;flex-direction:column;width:1400px;height:500px"><div class="explorer" id="first"></div></div><div style="display:flex;flex-direction:column;width:1400px;height:500px"><div class="explorer" id="second"></div></div>`;

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
document.body.insertAdjacentHTML("beforeend", ${JSON.stringify(HOSTS)});
import { mountPanelResizers } from ${JSON.stringify(here("panel-resizer-view.ts"))};

const memory = new Map();
const storage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => memory.set(key, value),
};

function mount(host) {
  host.innerHTML =
    '<nav class="rail"></nav><aside class="tree"></aside><main class="canvas"></main><aside class="inspector open"><div class="inspector-panel"></div></aside>';
  mountPanelResizers(
    host,
    { tree: host.querySelector(".tree"), inspector: host.querySelector(".inspector") },
    storage,
  );
  host.classList.add("inspector-open");
}

const widthOf = (host, selector) => host.querySelector(selector).getBoundingClientRect().width;

function drag(host, selector, dx) {
  const node = host.querySelector(selector);
  node.setPointerCapture = () => {};
  node.releasePointerCapture = () => {};
  const fire = (type, x) =>
    node.dispatchEvent(new PointerEvent(type, { pointerId: 1, clientX: x, bubbles: true }));
  fire("pointerdown", 500);
  fire("pointermove", 500 + dx);
  fire("pointerup", 500 + dx);
}

const report = {};
const first = document.getElementById("first");
const second = document.getElementById("second");

mount(first);
report.initial = { tree: widthOf(first, ".tree"), inspector: widthOf(first, ".inspector") };
drag(first, ".panel-resizer-tree", 50);
report.treeRight = widthOf(first, ".tree");
drag(first, ".panel-resizer-tree", 5000);
report.treeMax = widthOf(first, ".tree");
drag(first, ".panel-resizer-tree", -5000);
report.treeMin = widthOf(first, ".tree");
drag(first, ".panel-resizer-inspector", -60);
report.inspectorLeft = widthOf(first, ".inspector");
drag(first, ".panel-resizer-inspector", -5000);
report.inspectorMax = widthOf(first, ".inspector");
drag(first, ".panel-resizer-inspector", 5000);
report.inspectorMin = widthOf(first, ".inspector");
drag(first, ".panel-resizer-tree", 5000);
drag(first, ".panel-resizer-inspector", -90);
report.saved = memory.get("recognizer.panel-widths");

mount(second);
report.reopened = { tree: widthOf(second, ".tree"), inspector: widthOf(second, ".inspector") };

localStorage.setItem("recognizer.panel-widths", JSON.stringify({ tree: 222, inspector: 333 }));
report.realStorage = JSON.parse(localStorage.getItem("recognizer.panel-widths"));

window.addEventListener("load", () => {
  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(report))));
});`;

type Report = {
  initial: { tree: number; inspector: number };
  treeRight: number;
  treeMax: number;
  treeMin: number;
  inspectorLeft: number;
  inspectorMax: number;
  inspectorMin: number;
  saved: string;
  reopened: { tree: number; inspector: number };
  realStorage: { tree: number; inspector: number };
};

async function run(): Promise<Report> {
  return collectFacts<Report>(HARNESS, "resize-look", "bare");
}

describe("resizing the side panels in a real browser", () => {
  it.skipIf(webkit === undefined)(
    "drags each inner edge within its limits and reopens at the saved widths",
    async () => {
      const report = await run();

      expect(report.initial).toEqual({ tree: 280, inspector: 340 });
      expect(report.treeRight).toBe(330);
      expect(report.treeMax).toBe(480);
      expect(report.treeMin).toBe(200);
      expect(report.inspectorLeft).toBe(400);
      expect(report.inspectorMax).toBe(640);
      expect(report.inspectorMin).toBe(280);
      expect(JSON.parse(report.saved)).toEqual({ tree: 480, inspector: 370 });
      expect(report.reopened).toEqual({ tree: 480, inspector: 370 });
      expect(report.realStorage).toEqual({ tree: 222, inspector: 333 });
    },
    scaledTimeout(180000),
  );
});
