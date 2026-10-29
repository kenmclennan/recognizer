import { beforeAll, describe, expect, it } from "vitest";
import { chrome, collectFacts, FAKE_WORKER, here } from "./look-page";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { showExplorer } from ${JSON.stringify(here("explorer.ts"))};
import { fakeViews } from ${JSON.stringify(here("views-fake.ts"))};
${FAKE_WORKER}

const edge = (from, to) => ({ from, to, kind: "depends", line: 1, names: ["X"] });
const scanOf = (ids) => ({
  commit: "cur1234",
  modules: ids.map((id) => ({ id, kind: "module" })),
  edges: ids.length > 1 ? [edge(ids[0], ids[1])] : [],
  foreign: [],
});
const loadedOf = (ids) => ({ modules: ids, scans: [{ file: "scan.json", scan: scanOf(ids) }], policy: null, notices: [], blocking: null });
const before = ["app/hub.py", "app/a.py", "lib/c.py", "lib/d.py", "lib/e.py"];
const after = ["app/hub.py", "app/a.py", "lib/e.py"];

const tick = () => new Promise((resolve) => setTimeout(resolve, 40));
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const host = document.getElementById("content");
const q = (selector) => host.querySelector(selector);
const counts = { text: "" };
const notes = [];
const port = fakeViews({});
const facts = {};

(async () => {
  const first = showExplorer(host, loadedOf(before), "demo", (t) => { counts.text = t; }, port, (t) => notes.push(t));
  await tick();
  click(q('.tree .row[data-path="app"] .rcheck'));
  await tick();
  click(q('.tree .row[data-path="lib"] .rcheck'));
  await tick();
  facts.before = counts.text;

  const carried = first.carry();
  first.dispose();
  host.replaceChildren();
  showExplorer(host, loadedOf(after), "demo", (t) => { counts.text = t; }, port, (t) => notes.push(t), carried);
  await tick();
  facts.afterRescan = { count: counts.text, notes: [...notes], canBack: !q(".view-back").disabled, canForward: !q(".view-forward").disabled };

  click(q(".view-back"));
  click(q(".view-back"));
  await tick();
  facts.backTwice = counts.text;
  click(q(".view-forward"));
  click(q(".view-forward"));
  await tick();
  facts.forwardTwice = counts.text;

  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Facts = ReturnType<typeof JSON.parse>;

describe.skipIf(chrome === undefined)(
  "an explorer built from a carried one",
  () => {
    let f = null as unknown as Facts;

    beforeAll(async () => {
      f = await collectFacts<Facts>(HARNESS, "explorer-carry");
    }, 180000);

    it("keeps the surviving modules on the canvas and says how many are gone", () => {
      expect(f.before).toBe("5 of 5 modules on the canvas");
      expect(f.afterRescan.count).toBe("3 of 3 modules on the canvas");
      expect(f.afterRescan.notes).toContain(
        "Rescanned: 2 modules on the canvas are gone",
      );
    });

    it("walks the same history back and forward", () => {
      expect(f.afterRescan.canBack).toBe(true);
      expect(f.afterRescan.canForward).toBe(false);
      expect(f.backTwice).toBe("2 of 3 modules on the canvas");
      expect(f.forwardTwice).toBe("3 of 3 modules on the canvas");
    });
  },
);
