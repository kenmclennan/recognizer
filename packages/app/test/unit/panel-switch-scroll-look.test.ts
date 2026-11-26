import {
  parseBranches,
  parseHistory,
  parsePullRequests,
} from "@recognizer/core";
import { beforeAll, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../../tools/scripts/pool-scale.mjs";
import { collectFacts, FAKE_WORKER, here, webkit } from "../../src/look-page";
import { lookRoot } from "../look-root";

function harness(recording: unknown): string {
  return `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { drawRecording } from ${JSON.stringify(here("../test/look-draw.ts"))};
${FAKE_WORKER}

const recording = ${JSON.stringify(recording)};
const tick = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const host = document.createElement("div");
host.style.cssText = "width:1500px;height:500px;display:flex;flex-direction:column";
document.getElementById("content").append(host);
const q = (selector) => host.querySelector(selector);
const pin = (node, height) => { node.style.flex = "none"; node.style.height = height; node.style.overflow = "auto"; };

(async () => {
  const facts = {};

  await drawRecording(host, recording);
  await tick();

  click(q(".rail-commits"));
  await tick(150);
  click(q(".commits-hide"));
  await tick();
  pin(q(".commits-list"), "120px");
  q(".commits-list").scrollTop = 400;
  await tick();
  const before = q(".commits-list").scrollTop;

  click(q(".rail-scan"));
  await tick(150);
  const scanShown = q(".scan-panel") !== null;
  click(q(".rail-commits"));
  await tick(200);
  pin(q(".commits-list"), "120px");
  await tick();

  facts.commits = { before, scanShown, after: q(".commits-list").scrollTop };

  click(q(".rail-scan"));
  await tick(150);
  pin(q(".scan-panel"), "40px");
  const filler = document.createElement("div");
  filler.style.height = "600px";
  q(".scan-panel").append(filler);
  q(".scan-panel").scrollTop = 120;
  const scanBefore = q(".scan-panel").scrollTop;
  click(q(".rail-commits"));
  await tick(150);
  click(q(".rail-scan"));
  await tick(150);
  facts.scan = { before: scanBefore, after: q(".scan-panel").scrollTop };

  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;
}

type Facts = ReturnType<typeof JSON.parse>;

describe.skipIf(webkit === undefined)("switching side panels", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    const sha = (n: number) => String(n).padStart(2, "0").repeat(20);
    const RS = String.fromCharCode(30);
    const US = String.fromCharCode(31);
    const record = (n: number, parent: number | null) =>
      `${RS}${[sha(n), sha(n).slice(0, 7), parent === null ? "" : sha(parent), "Ken", "1700000000", `change ${n}`, ""].join(US)}\n\nM\tapp/hub.py\n`;
    const history = Array.from({ length: 60 }, (_, i) =>
      record(60 - i, i === 59 ? null : 59 - i),
    ).join("");
    const { produced: _produced, ...recording } = await lookRoot({
      answers: {
        "history.list": { ok: { branch: "main", ...parseHistory(history) } },
        "history.branches": {
          ok: {
            defaultRef: "origin/main",
            total: 0,
            ...parseBranches(""),
          },
        },
        "history.pulls": {
          ok: { status: "ok", detail: "", ...parsePullRequests("[]") },
        },
        "history.facts": { ok: [] },
      },
    });

    f = await collectFacts<Facts>(harness(recording), "panel-switch-scroll");
  }, scaledTimeout(180000));

  it("puts the commits list back at its scrolled offset when the panel is shown again", () => {
    expect(f.commits.scanShown).toBe(true);
    expect(f.commits.before).toBeGreaterThan(0);
    expect(f.commits.after).toBe(f.commits.before);
  });

  it("puts the scan panel back at its scrolled offset when it is shown again", () => {
    expect(f.scan.before).toBeGreaterThan(0);
    expect(f.scan.after).toBe(f.scan.before);
  });
});
