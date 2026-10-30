import { beforeAll, describe, expect, it } from "vitest";
import { chrome, collectFacts, FAKE_WORKER, here } from "./look-page";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { showExplorer } from ${JSON.stringify(here("explorer.ts"))};
import { fakeResponsibilities } from ${JSON.stringify(here("responsibilities-fake.ts"))};
${FAKE_WORKER}

const members = [{ name: "f", kind: "function", exported: true, line: 1, params: [] }];
const edge = { from: "p/m.py", to: "p/o.py", kind: "depends", line: 1, names: ["f"] };
const scan = {
  modules: ["p/m.py", "p/o.py", "p/n.py", "p/q.py"].map((id) => ({ id, kind: "module", members })),
  edges: [edge],
  foreign: [],
};
const loaded = { modules: scan.modules.map((m) => m.id), scans: [{ file: "scan.json", scan }], policy: null, notices: [], blocking: null };

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
  const explorer = showExplorer(host, loaded, "demo", () => {}, undefined, () => {}, null, undefined, undefined, undefined, fake);
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
  const button = row && row.querySelector("button.describe");
  const line = row && row.querySelector(".line");
  return {
    present: !!row,
    kind: row ? row.className.replace("responsibility", "").trim() : null,
    text: row ? row.textContent : null,
    tags: row ? [...row.querySelectorAll(".tag")].map((n) => n.textContent) : [],
    lineOpacity: line ? cs(line).opacity : null,
    button: button ? { text: button.textContent, disabled: button.disabled, title: button.title } : null,
    finding: row && row.querySelector(".finding") ? row.querySelector(".finding").textContent : null,
    beforeSwitch: row && root.querySelector(".pswitch") ? !!(row.compareDocumentPosition(root.querySelector(".pswitch")) & Node.DOCUMENT_POSITION_FOLLOWING) : null,
    first: root.querySelector(".responsibility") === [...root.querySelectorAll(".responsibility, .pswitch")][0],
  };
}

(async () => {
  const facts = {};
  const fake = fakeResponsibilities(initial(), {
    onDescribe(module, f) {
      const files = JSON.parse(f.files.responsibilities);
      files.modules[module] = entry("Fresh line for " + module + ".");
      f.files = { ...f.files, responsibilities: JSON.stringify(files) };
    },
  });
  let explorer = await open(fake);

  await select("p/m.py");
  facts.current = snap();
  await select("p/q.py");
  facts.missing = snap();
  await select("p/o.py");
  facts.outOfDate = snap();
  facts.describedBefore = [...fake.described];

  fake.described.length = 0;
  await select("p/m.py");
  explorer.dispose();
  facts.unasked = { described: fake.described.length };

  const held = fakeResponsibilities(initial(), { hold: true, onDescribe(module, f) {
    const files = JSON.parse(f.files.responsibilities);
    files.modules[module] = entry("Fresh line for " + module + ".");
    f.files = { ...f.files, responsibilities: JSON.stringify(files) };
  } });
  explorer = await open(held);
  await select("p/o.py");
  if (!q(".responsibility button.describe")) throw new Error("no button: " + (q(".inspector-panel") ? q(".inspector-panel").textContent.slice(0, 300) : "no panel"));
  click(q(".responsibility button.describe"));
  await tick();
  facts.busy = snap();
  click(q(".responsibility button.describe"));
  await tick();
  facts.busyDescribed = [...held.described];
  await held.settle();
  await tick();
  facts.after = snap();
  facts.afterDescribed = [...held.described];
  await select("p/n.py");
  facts.other = snap();
  explorer.dispose();

  const failing = fakeResponsibilities(initial(), { result: { status: "failed", reason: "model timed out" } });
  explorer = await open(failing);
  await select("p/o.py");
  click(q(".responsibility button.describe"));
  await tick();
  facts.failed = snap();
  facts.failedDescribed = [...failing.described];
  explorer.dispose();

  const watched = fakeResponsibilities(initial());
  explorer = await open(watched);
  await select("p/q.py");
  facts.beforeEdit = snap().kind;
  watched.edit(filesOf({ "p/q.py": entry("Written elsewhere.") }, { "p/q.py": HASH }));
  await tick();
  facts.afterEdit = snap();
  watched.edit({ responsibilities: "not json", config: null, refused: [], hashes: {} });
  await tick();
  facts.invalid = snap();
  facts.watchedDescribed = watched.described.length;
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
  tags: string[];
  lineOpacity: string | null;
  button: { text: string; disabled: boolean; title: string } | null;
  finding: string | null;
  beforeSwitch: boolean | null;
  first: boolean;
};
type Facts = {
  current: Snap;
  missing: Snap;
  outOfDate: Snap;
  describedBefore: string[];
  unasked: { described: number };
  busy: Snap;
  busyDescribed: string[];
  after: Snap;
  afterDescribed: string[];
  other: Snap;
  failed: Snap;
  failedDescribed: string[];
  beforeEdit: string;
  afterEdit: Snap;
  invalid: Snap;
  watchedDescribed: number;
  dependenciesTab: number;
  trail: { name: string; row: string | null }[];
};

describe.skipIf(chrome === undefined)("the responsibility row", () => {
  let facts: Facts;

  beforeAll(async () => {
    facts = await collectFacts<Facts>(HARNESS, "responsibility");
  }, 240000);

  it("shows a current line tagged Generated above the Show private switch", () => {
    expect(facts.current.kind).toBe("current");
    expect(facts.current.text).toBe("Current line.Generated");
    expect(facts.current.tags).toEqual(["Generated"]);
    expect(facts.current.button).toBeNull();
    expect(facts.current.lineOpacity).toBe("1");
    expect(facts.current.beforeSwitch).toBe(true);
    expect(facts.current.first).toBe(true);
  });

  it("dims an out-of-date line, tags it and offers a Describe button", () => {
    expect(facts.outOfDate.kind).toBe("out-of-date");
    expect(facts.outOfDate.tags).toEqual(["Generated", "Out of date"]);
    expect(Number(facts.outOfDate.lineOpacity)).toBeLessThan(1);
    expect(facts.outOfDate.button).toEqual({
      text: "Describe",
      disabled: false,
      title: "source changed",
    });
    expect(facts.outOfDate.beforeSwitch).toBe(true);
  });

  it("says so when a module has no line, with no button", () => {
    expect(facts.missing.text).toBe("No responsibility line yet");
    expect(facts.missing.button).toBeNull();
    expect(facts.missing.beforeSwitch).toBe(true);
  });

  it("describes nothing unasked", () => {
    expect(facts.describedBefore).toEqual([]);
    expect(facts.unasked.described).toBe(0);
    expect(facts.watchedDescribed).toBe(0);
  });

  it("describes exactly that module on click, disabled while it runs", () => {
    expect(facts.busy.button).toEqual({
      text: "Describing",
      disabled: true,
      title: "source changed",
    });
    expect(facts.busyDescribed).toEqual(["p/o.py"]);
    expect(facts.afterDescribed).toEqual(["p/o.py"]);
  });

  it("shows the new line as current afterwards and leaves other modules alone", () => {
    expect(facts.after.kind).toBe("current");
    expect(facts.after.text).toBe("Fresh line for p/o.py.Generated");
    expect(facts.other.kind).toBe("out-of-date");
    expect(facts.other.text).toContain("Other stale.");
  });

  it("shows a failed describe's reason and keeps the old line dimmed", () => {
    expect(facts.failedDescribed).toEqual(["p/o.py"]);
    expect(facts.failed.kind).toBe("out-of-date");
    expect(facts.failed.finding).toBe("model timed out");
    expect(facts.failed.text).toContain("Stale line.");
    expect(facts.failed.button?.disabled).toBe(false);
  });

  it("updates when the files change and reports invalid files as unknown", () => {
    expect(facts.beforeEdit).toBe("missing");
    expect(facts.afterEdit.kind).toBe("current");
    expect(facts.afterEdit.text).toBe("Written elsewhere.Generated");
    expect(facts.invalid.kind).toBe("unknown");
    expect(facts.invalid.text).toMatch(/^Responsibility unknown: /);
    expect(facts.invalid.button).toBeNull();
  });

  it("is absent from the Dependencies tab", () => {
    expect(facts.dependenciesTab).toBe(0);
  });

  it("appears in each panel of a trail for that panel's module", () => {
    expect(facts.trail).toEqual([
      { name: "m.py", row: "Current line.Generated" },
      { name: "o.py", row: expect.stringContaining("Stale line.") },
    ]);
  });
});
