import { beforeAll, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../scripts/pool-scale.mjs";
import { collectFacts, here, webkit } from "./look-page";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { showHolding } from ${JSON.stringify(here("holding-view.ts"))};

const content = document.getElementById("content");
let stops = 0;
const view = showHolding(content, () => { stops += 1; }, "Mutation 3 of 10");
const q = (selector) => content.querySelector(selector);
const facts = {};

facts.title = q(".message").textContent;
facts.line = q(".holding-line").textContent;
facts.stop = q(".holding-stop").textContent;
view.update("Mutation 4 of 10");
facts.updated = q(".holding-line").textContent;
q(".holding-stop").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
facts.stops = stops;
const holder = q(".holding").getBoundingClientRect();
const button = q(".holding-stop").getBoundingClientRect();
const host = content.getBoundingClientRect();
facts.fits = button.left >= host.left && button.right <= host.right && button.bottom <= host.bottom && holder.width <= host.width;
view.remove();
facts.removed = content.children.length;

document.getElementById("out").textContent = btoa(JSON.stringify(facts));
`;

type Facts = {
  title: string;
  line: string;
  stop: string;
  updated: string;
  stops: number;
  fits: boolean;
  removed: number;
};

describe.skipIf(webkit === undefined)("the attached scan holding view", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = await collectFacts<Facts>(HARNESS, "holding-view-look");
  }, scaledTimeout(180000));

  it("shows the title, the progress line and a Stop button that calls the port", () => {
    expect(f.title).toBe("A scan is running on this repository");
    expect(f.line).toBe("Mutation 3 of 10");
    expect(f.stop).toBe("Stop");
    expect(f.updated).toBe("Mutation 4 of 10");
    expect(f.stops).toBe(1);
  });

  it("keeps the Stop button inside the window and can be removed", () => {
    expect(f.fits).toBe(true);
    expect(f.removed).toBe(0);
  });
});
