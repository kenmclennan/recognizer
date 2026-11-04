import { beforeAll, describe, expect, it } from "vitest";
import { chrome, collectFacts, FAKE_WORKER, here } from "./look-page";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { loadedOf, mountExplorer } from ${JSON.stringify(here("look-support.ts"))};
import { fakeResponsibilities } from ${JSON.stringify(here("responsibilities-fake.ts"))};
${FAKE_WORKER}

const members = [{ name: "f", kind: "function", exported: true, line: 1, params: [] }];
const edge = { from: "p/m.py", to: "p/o.py", kind: "depends", line: 1, names: ["f"] };
const scan = {
  modules: ["p/m.py", "p/o.py", "p/n.py", "p/q.py"].map((id) => ({ id, kind: "module", members })),
  edges: [edge],
  foreign: [],
};
const loaded = loadedOf({ modules: scan.modules.map((m) => m.id), scans: [{ file: "scan.json", scan }] });

const COMMAND = ["node", "d.js"];
const HASH = "a".repeat(64);
const entry = (line, hash = HASH, version = "v1") => ({ line, source_hash: hash, describer: COMMAND, version });
const filesOf = (modules, hashes) => ({
  responsibilities: JSON.stringify({ schema_version: 1, modules }),
  config: "describer:\\n  command: [node, d.js]\\n  version: v1\\n",
  refused: [],
  hashes,
});
const initial = () => filesOf(
  { "p/m.py": entry("Current line."), "p/o.py": entry("Stale line.", "b".repeat(64)), "p/n.py": entry("Other stale.", "c".repeat(64)) },
  { "p/m.py": HASH, "p/o.py": HASH, "p/n.py": HASH, "p/q.py": HASH },
);

const tick = () => new Promise((resolve) => setTimeout(resolve, 40));
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const host = document.getElementById("content");
const q = (selector) => host.querySelector(selector);
const qa = (selector) => [...host.querySelectorAll(selector)];
const cs = (node) => getComputedStyle(node);

async function open(fake) {
  host.replaceChildren();
  const explorer = mountExplorer({ container: host, loaded, title: "demo", post: () => null, responsibilities: fake });
  await tick();
  return explorer;
}

async function select(id) {
  if (!q('.tree .row[data-path="' + id + '"]')) {
    click(q('.tree .row[data-path="p"] .name'));
    await tick();
  }
  const check = q('.tree .row[data-path="' + id + '"] .rcheck');
  if (check.getAttribute("aria-checked") !== "true") {
    click(check);
    await tick();
  }
  click(q('.box[data-id="' + id + '"] .box-body'));
  await tick();
  if (!q(".inspector-panel .pswitch")) {
    click(q('.selection-bar [aria-label^="Contents"]'));
    await tick();
  }
}

function snap(scope) {
  const root = scope || q(".inspector-panel");
  const row = root.querySelector(".responsibility");
  const line = row && row.querySelector(".line");
  return {
    present: !!row,
    kind: row ? row.className.replace("responsibility", "").trim() : null,
    text: row ? row.textContent : null,
    tags: row ? row.querySelectorAll(".tag").length : 0,
    lineOpacity: line ? cs(line).opacity : null,
    buttons: row ? row.querySelectorAll("button").length : 0,
    finding: row && row.querySelector(".finding") ? row.querySelector(".finding").textContent : null,
    beforeSwitch: row && root.querySelector(".itabs") ? !!(row.compareDocumentPosition(root.querySelector(".itabs")) & Node.DOCUMENT_POSITION_FOLLOWING) : null,
    first: !!row && row.previousElementSibling === root.querySelector(".ih"),
  };
}

(async () => {
  const facts = {};
  const fake = fakeResponsibilities(initial());
  let explorer = await open(fake);

  await select("p/m.py");
  facts.current = snap();
  await select("p/q.py");
  facts.missing = snap();
  await select("p/o.py");
  facts.outOfDate = snap();
  await select("p/n.py");
  facts.other = snap();
  explorer.dispose();

  const failing = fakeResponsibilities(initial());
  explorer = await open(failing);
  await select("p/o.py");
  facts.noControls = qa(".inspector-panel button.describe, .inspector-panel .tag").length;
  explorer.dispose();

  const watched = fakeResponsibilities(initial());
  explorer = await open(watched);
  await select("p/q.py");
  facts.beforeEdit = snap().present;
  watched.edit(filesOf({ "p/q.py": entry("Written elsewhere.") }, { "p/q.py": HASH }));
  await tick();
  facts.afterEdit = snap();
  watched.edit({ responsibilities: "not json", config: null, refused: [], hashes: {} });
  await tick();
  facts.invalid = snap();
  explorer.dispose();

  explorer = await open(fakeResponsibilities(initial()));
  await select("p/m.py");
  click(q('.selection-bar [aria-label^="Dependencies"]'));
  await tick();
  facts.dependenciesTab = qa(".inspector-panel .responsibility").length;
  click(q('.inspector-panel .row[data-id="p/o.py"][data-follow="uses"]').parentElement.querySelector(".follow"));
  await tick();
  for (const panel of qa(".inspector-panel")) {
    const contents = [...panel.querySelectorAll(".itabs button")].find((b) => b.textContent.startsWith("Contents"));
    if (contents) { click(contents); await tick(); }
  }
  facts.trail = qa(".inspector-panel").map((p) => ({ name: p.querySelector(".ih-name").textContent, row: snap(p).text }));

  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Snap = {
  present: boolean;
  kind: string | null;
  text: string | null;
  tags: number;
  lineOpacity: string | null;
  buttons: number;
  finding: string | null;
  beforeSwitch: boolean | null;
  first: boolean;
};
type Facts = {
  current: Snap;
  missing: Snap;
  outOfDate: Snap;
  other: Snap;
  noControls: number;
  beforeEdit: boolean;
  afterEdit: Snap;
  invalid: Snap;
  dependenciesTab: number;
  trail: { name: string; row: string | null }[];
};

describe.skipIf(chrome === undefined)("the responsibility row", () => {
  let facts: Facts;

  beforeAll(async () => {
    facts = await collectFacts<Facts>(HARNESS, "responsibility");
  }, 240000);

  it("shows a current line alone under the name and above the tabs", () => {
    expect(facts.current.kind).toBe("current");
    expect(facts.current.text).toBe("Current line.");
    expect(facts.current.tags).toBe(0);
    expect(facts.current.buttons).toBe(0);
    expect(facts.current.lineOpacity).toBe("1");
    expect(facts.current.beforeSwitch).toBe(true);
    expect(facts.current.first).toBe(true);
  });

  it("shows an out-of-date line undimmed with no tag and no button", () => {
    expect(facts.outOfDate.kind).toBe("out-of-date");
    expect(facts.outOfDate.text).toBe("Stale line.");
    expect(facts.outOfDate.tags).toBe(0);
    expect(facts.outOfDate.buttons).toBe(0);
    expect(facts.outOfDate.lineOpacity).toBe("1");
    expect(facts.outOfDate.beforeSwitch).toBe(true);
    expect(facts.other.text).toBe("Other stale.");
  });

  it("shows no text and no button when a module has no line", () => {
    expect(facts.missing.present).toBe(false);
    expect(facts.missing.text).toBeNull();
    expect(facts.missing.buttons).toBe(0);
  });

  it("offers nothing that describes", () => {
    expect(facts.noControls).toBe(0);
  });

  it("updates when the files change and reports invalid files as unknown", () => {
    expect(facts.beforeEdit).toBe(false);
    expect(facts.afterEdit.kind).toBe("current");
    expect(facts.afterEdit.text).toBe("Written elsewhere.");
    expect(facts.invalid.kind).toBe("unknown");
    expect(facts.invalid.text).toMatch(/^Responsibility unknown: /);
    expect(facts.invalid.buttons).toBe(0);
  });

  it("stays in the header on the Dependencies tab", () => {
    expect(facts.dependenciesTab).toBe(1);
  });

  it("appears in each panel of a trail for that panel's module", () => {
    expect(facts.trail).toEqual([
      { name: "m.py", row: "Current line." },
      { name: "o.py", row: "Stale line." },
    ]);
  });
});
