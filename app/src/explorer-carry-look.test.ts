import { beforeAll, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../scripts/pool-scale.mjs";
import { collectFacts, FAKE_WORKER, here, webkit } from "./look-page";

const HARNESS = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { loadedOf, mountExplorer } from ${JSON.stringify(here("look-support.ts"))};
import { fakeViews } from ${JSON.stringify(here("views-fake.ts"))};
import { buildFooter } from ${JSON.stringify(here("footer-view.ts"))};
import { createViewComparisons } from ${JSON.stringify(here("view-comparisons.ts"))};
${FAKE_WORKER}

const edge = (from, to) => ({ from, to, kind: "depends", line: 1, names: ["X"] });
const scanOf = (ids) => ({
  commit: "cur1234",
  modules: ids.map((id) => ({ id, kind: "module" })),
  edges: ids.length > 1 ? [edge(ids[0], ids[1])] : [],
  foreign: [],
});
const loadedFor = (ids) => loadedOf({ modules: ids, scans: [{ file: "scan.json", scan: scanOf(ids) }] });
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
  const first = mountExplorer({ container: host, loaded: loadedFor(before), title: "demo", onCount: (t) => { counts.text = t; }, views: port, post: (input) => { notes.push(input.text); return null; } });
  await tick();
  click(q('.tree .row[data-path="app"] .rcheck'));
  await tick();
  click(q('.tree .row[data-path="lib"] .rcheck'));
  await tick();
  facts.before = counts.text;

  const carried = first.carry();
  first.dispose();
  host.replaceChildren();
  mountExplorer({ container: host, loaded: loadedFor(after), title: "demo", onCount: (t) => { counts.text = t; }, views: port, post: (input) => { notes.push(input.text); return null; }, carried });
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

  const footerEl = document.createElement("footer");
  footerEl.className = "footer";
  document.body.append(footerEl);
  const footer = buildFooter(footerEl);
  const rows = () => [...footerEl.querySelectorAll(".message-list .msg-text")].map((n) => n.textContent);
  const withCommit = (commit) => ({ ...loadedFor(before), scans: loadedFor(before).scans.map((s) => ({ ...s, scan: { ...s.scan, commit } })) });
  const staleText = JSON.stringify({ schema_version: 1, description: "d", commit: "old1234", steps: [{ kind: "pick", module: "app/hub.py" }, { kind: "pick", module: "lib/gone.py" }] });
  const stalePort = fakeViews({ stale: staleText });
  const scanCalls = [];
  const scansAt = stalePort.scansAt;
  stalePort.scansAt = (commit) => { scanCalls.push(commit); return scansAt(commit); };
  stalePort.scansByCommit.set("old1234", [scanOf(before)]);
  stalePort.scansByCommit.set("cur1234", [scanOf(before)]);
  const memo = createViewComparisons();
  const build = (commit, carriedFrom) => {
    host.replaceChildren();
    return mountExplorer({ container: host, loaded: withCommit(commit), title: "demo", views: stalePort, post: footer.post, withdraw: footer.withdraw, reconcileMessages: footer.reconcile, comparisons: memo, carried: carriedFrom });
  };
  const staleFirst = build("cur1234", null);
  await tick();
  click(q(".view-list"));
  click(q(".view-item"));
  await tick();
  const afterOpen = { rows: rows(), scans: scanCalls.length };
  const staleSecond = build("cur1234", staleFirst.carry());
  staleFirst.dispose();
  await tick();
  const afterRebuild = { rows: rows(), scans: scanCalls.length };
  const staleThird = build("new5678", staleSecond.carry());
  staleSecond.dispose();
  await tick();
  facts.stale = { afterOpen, afterRebuild, afterNewCommit: { rows: rows(), scans: scanCalls.length } };
  staleThird.dispose();

  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Facts = ReturnType<typeof JSON.parse>;

describe.skipIf(webkit === undefined)(
  "an explorer built from a carried one",
  () => {
    let f = null as unknown as Facts;

    beforeAll(async () => {
      f = await collectFacts<Facts>(HARNESS, "explorer-carry");
    }, scaledTimeout(180000));

    it("keeps the surviving modules on the canvas and says how many are gone", () => {
      expect(f.before).toBe("5 of 5 modules on the canvas");
      expect(f.afterRescan.count).toBe("3 of 3 modules on the canvas");
      expect(f.afterRescan.notes).toContain(
        "Rescanned: 2 modules on the canvas are gone",
      );
    });

    it("(non-gating) compares a carried view once per commit pair and re-compares at a new scan commit", () => {
      const one = (commit: string) => expect.stringContaining(commit);

      expect(f.stale.afterOpen.rows).toHaveLength(1);
      expect(f.stale.afterOpen.scans).toBe(1);
      expect(f.stale.afterRebuild.rows).toEqual(f.stale.afterOpen.rows);
      expect(f.stale.afterRebuild.scans).toBe(1);
      expect(f.stale.afterNewCommit.rows).toHaveLength(1);
      expect(f.stale.afterNewCommit.scans).toBe(2);
      expect(f.stale.afterNewCommit.rows[0]).toEqual(one("old1234"));
    });

    it("walks the same history back and forward", () => {
      expect(f.afterRescan.canBack).toBe(true);
      expect(f.afterRescan.canForward).toBe(false);
      expect(f.backTwice).toBe("2 of 3 modules on the canvas");
      expect(f.forwardTwice).toBe("3 of 3 modules on the canvas");
    });
  },
);
