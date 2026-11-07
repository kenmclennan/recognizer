import { beforeAll, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../scripts/pool-scale.mjs";
import { collectFacts, here, webkit } from "./look-page";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
window.__TAURI_INTERNALS__ = { invoke: async () => "0.0.0" };
import { buildFooter } from ${JSON.stringify(here("footer-view.ts"))};

const footer = document.getElementById("footer");
const view = buildFooter(footer);
const q = (selector) => footer.querySelector(selector);
const buttons = () => [...footer.querySelectorAll("button")].filter((b) => !b.closest(".message-tray, .message-toast")).map((b) => b.className);
const removed = () => footer.querySelectorAll(".rescan-button, .scan-stop, .scan-show, .scan-open-log, .scan-dot, .scan-count, .changes-list").length;
const shape = () => ({
  text: q(".scan-line").textContent,
  children: q(".scan-line").children.length,
  buttons: buttons(),
  removed: removed(),
});
const facts = {};

facts.initial = shape();

view.setScan("Mutation: 251 of 1,204 functions");
facts.running = shape();

view.setScan("Scanning…");
facts.bare = shape();

view.setScan(null);
facts.afterEnd = shape();

document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
`;

type Facts = ReturnType<typeof JSON.parse>;

describe.skipIf(webkit === undefined)("the footer's scan line", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    f = await collectFacts<Facts>(HARNESS, "footer-look");
  }, scaledTimeout(180000));

  it("shows nothing before a run, with only the bell as a button", () => {
    expect(f.initial.text).toBe("");
    expect(f.initial.children).toBe(0);
    expect(f.initial.buttons).toEqual(["bell"]);
  });

  it("shows the run's progress line while one is running", () => {
    expect(f.running.text).toBe("Mutation: 251 of 1,204 functions");
    expect(f.running.buttons).toEqual(["bell"]);
    expect(f.bare.text).toBe("Scanning…");
  });

  it("shows no scanned-at or changed-files text once the run ends", () => {
    expect(f.afterEnd.text).toBe("");
    expect(f.afterEnd.buttons).toEqual(["bell"]);
  });

  it("never draws Rescan, Stop, Show, Open log, a changed-files count or its list in any state", () => {
    for (const state of [f.initial, f.running, f.bare, f.afterEnd]) {
      expect(state.removed).toBe(0);
    }
  });
});
