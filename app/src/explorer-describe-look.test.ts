import { beforeAll, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../scripts/pool-scale.mjs";
import { collectFacts, FAKE_WORKER, here, webkit } from "./look-page";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { loadedOf, mountExplorer } from ${JSON.stringify(here("look-support.ts"))};
import { fakeResponsibilities } from ${JSON.stringify(here("responsibilities-fake.ts"))};
${FAKE_WORKER}

const ids = ["p/a.py", "p/b.py", "p/c.py"];
const members = [{ name: "f", kind: "function", exported: true, line: 1, params: [] }];
const scan = {
  modules: ids.map((id) => ({ id, kind: "module", members })),
  edges: [{ from: "p/a.py", to: "p/b.py", kind: "depends", line: 1, names: ["f"] }],
  foreign: [],
};
const loaded = loadedOf({ modules: ids, scans: [{ file: "scan.json", scan }] });

const COMMAND = ["node", "d.js"];
const HASH = "a".repeat(64);
const entry = (line, hash = HASH) => ({ line, source_hash: hash, describer: COMMAND, version: "v1" });
const filesOf = (modules) => ({
  responsibilities: JSON.stringify({ schema_version: 1, modules }),
  config: "describer:\\n  command: [node, d.js]\\n  version: v1\\n",
  refused: [],
  hashes: { "p/a.py": HASH, "p/b.py": HASH, "p/c.py": HASH },
});
const initial = () => filesOf({ "p/a.py": entry("A line.") });

const steps = [
  ["b described", () => filesOf({ "p/a.py": entry("A line."), "p/b.py": entry("B line.") })],
  ["c described", () => filesOf({ "p/a.py": entry("A line."), "p/b.py": entry("B line."), "p/c.py": entry("C line.") })],
  ["a out of date", () => filesOf({ "p/a.py": entry("A line.", "c".repeat(64)), "p/b.py": entry("B line."), "p/c.py": entry("C line.") })],
  ["unknown", () => ({ responsibilities: "not json", config: null, refused: [], hashes: {} })],
];

const tick = () => new Promise((resolve) => setTimeout(resolve, 60));
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const host = document.getElementById("content");
const q = (selector) => host.querySelector(selector);

async function mount(fake) {
  host.replaceChildren();
  const explorer = mountExplorer({ container: host, loaded, title: "demo", post: () => null, responsibilities: fake });
  await tick();
  return explorer;
}

async function openEverything() {
  click(q('.tree .row[data-path="p"] .name'));
  await tick();
  for (const id of ids) {
    click(q('.tree .row[data-path="' + id + '"] .reye'));
    await tick();
  }
  click(q('.box[data-id="p/b.py"] .box-body'));
  await tick();
  if (!q(".inspector-panel .pswitch")) {
    click(q('.selection-bar [aria-label^="Contents"]'));
    await tick();
  }
}

(async () => {
  const facts = {};

  const first = fakeResponsibilities(initial());
  const early = await mount(first);
  first.edit(steps[0][1]());
  await tick();
  const narrowFirst = host.innerHTML;
  early.update(loaded);
  facts.first = narrowFirst === host.innerHTML;
  early.dispose();

  const fake = fakeResponsibilities(initial());
  const explorer = await mount(fake);
  await openEverything();

  const watched = { tree: ".tree .rows", notes: ".notes-panel", views: ".views-panel", canvas: ".stage", scan: ".scan-panel", inspector: ".inspector-panel" };
  facts.present = Object.fromEntries(Object.entries(watched).map(([key, selector]) => [key, !!q(selector)]));
  facts.filled = Object.fromEntries(Object.entries(watched).map(([key, selector]) => [key, !!q(selector) && q(selector).textContent.trim().length > 0]));
  facts.equivalence = [];
  facts.mutations = {};

  for (const [name, make] of steps) {
    const counts = {};
    const observers = Object.entries(watched).filter(([, selector]) => q(selector)).map(([key, selector]) => {
      counts[key] = 0;
      const observer = new MutationObserver((records) => { counts[key] += records.length; });
      observer.observe(q(selector), { subtree: true, childList: true, attributes: true, characterData: true });
      return observer;
    });
    fake.edit(make());
    await tick();
    for (const observer of observers) observer.disconnect();
    facts.mutations[name] = counts;
    const narrow = host.innerHTML;
    explorer.update(loaded);
    facts.equivalence.push({ name, same: narrow === host.innerHTML });
  }

  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Facts = ReturnType<typeof JSON.parse>;

describe.skipIf(webkit === undefined)(
  "describe results re-render only what they change",
  () => {
    let f = null as unknown as Facts;

    beforeAll(async () => {
      f = await collectFacts<Facts>(HARNESS, "explorer-describe-look");
    }, scaledTimeout(180000));

    it("draws what a full render draws for the first result after mount", () => {
      expect(f.first).toBe(true);
    });

    it("draws what a full render draws after every scripted describe entry", () => {
      for (const step of f.equivalence) {
        expect(step, step.name).toEqual({ name: step.name, same: true });
      }
    });

    it("shows a notes panel and a views panel with content before the scripted steps", () => {
      expect(f.present.notes).toBe(true);
      expect(f.present.views).toBe(true);
      expect(f.filled.notes).toBe(true);
      expect(f.filled.views).toBe(true);
    });

    it("leaves the notes panel and the views panel untouched on every describe entry", () => {
      for (const counts of Object.values(f.mutations) as Record<
        string,
        number
      >[]) {
        expect(counts.notes ?? 0).toBe(0);
        expect(counts.views ?? 0).toBe(0);
      }
    });

    it("re-renders the tree, canvas, inspector and Scan panel when a module's line is written", () => {
      const counts = f.mutations["b described"];

      expect(counts.tree).toBeGreaterThan(0);
      expect(counts.canvas).toBeGreaterThan(0);
      expect(counts.scan).toBeGreaterThan(0);
      expect(counts.inspector).toBeGreaterThan(0);
    });
  },
);
