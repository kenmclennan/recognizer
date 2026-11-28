import { beforeAll, describe, expect, it } from "vitest";
import REASONS from "../../../fixtures/sensor-reasons/states.json";
import { scaledTimeout } from "../../../tools/scripts/pool-scale.mjs";
import { sensorProgram } from "../../cli/test/support/index";
import { collectFacts, FAKE_WORKER, here, webkit } from "../src/look-page";
import { untilHolds } from "./app-harness";
import { answerFor, reviveLoaded } from "./look-recording";
import {
  failingProgram,
  Gate,
  heldProgram,
  type LookScenario,
  lookRoot,
  lookRoots,
  scanProgram,
} from "./look-root";

const SHAPE = `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message); });
import { invoke } from "@tauri-apps/api/core";
import { installRecording } from ${JSON.stringify(here("../test/look-draw.ts"))};
${FAKE_WORKER}
`;

function harness(recording: unknown): string {
  return `${SHAPE}
const recording = ${JSON.stringify(recording)};
const encode = (value) => btoa(unescape(encodeURIComponent(JSON.stringify(value))));

(async () => {
  installRecording(recording);

  const refused = await invoke("nonesuch", { a: 1 }).then(() => null, (error) => String(error.message ?? error));
  const served = await invoke("core_call", { op: "nonesuch.op", args: {} });

  document.getElementById("out").textContent = encode({ refused, served });
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message); });
`;
}

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const HASH = "1".repeat(64);

const documentOf = (ids: string[]) => ({
  commit: COMMIT,
  modified: false,
  files: ids.map((id) => ({ path: id, hash: HASH })),
  modules: ids.map((id) => ({ id, kind: "module" })),
  edges: [],
  foreign: [],
});

const CRAP_ONLY =
  "sensors:\n  crap:\n    manifest: [recognizer-sense-crap, manifest]\n";
const OVERLAY_PATH = ".recognizer/cache/overlays/crap.json";
const OVERLAY = JSON.stringify({
  overlay_version: 1,
  commit: COMMIT,
  inputs: { "app/one.py": HASH },
  modified: false,
  producer: { name: "crap", version: "0.1.0" },
  metrics: [
    { name: "complexity", type: "count", granularity: "member", bad: "high" },
  ],
  values: { complexity: {} },
});

type Root = Parameters<NonNullable<LookScenario["warm"]>>[0];

const unregisteredAfter = {
  stages: [
    {
      name: "first",
      run: async (root: Root) => {
        while ((await root.view.rows()).length !== 2) {
          await root.service.signal(50);
        }
      },
    },
    {
      name: "second",
      run: async (root: Root) => {
        const events = () =>
          root.lines.filter((line) => typeof line.id !== "number").length;
        const before = events();

        root.io.files.writeFile(
          `${root.repository}/.recognizer/config.yaml`,
          CRAP_ONLY,
        );

        while (events() === before) {
          await root.service.signal(50);
        }
      },
    },
  ],
};

type GapFacts = { reached: boolean; text: string };

const gapsDraw = (
  op: string,
) => `const GAP = { id: "crap", line: "crap needs coverage", needs: ["coverage"] };
  const drawn = await drawRecording(host, recording, {
    answer: (command, args) =>
      command === "core_call" && args.op === ${JSON.stringify(op)} && (args.op !== "scan.plan" || args.args.mode === "rescan")
        ? { unavailable: { kind: "gaps", gaps: [GAP] } }
        : undefined,
  });
  await tick();
  const bridge = window.__lookBridge;
  for (const id of bridge.listening.get("rescan") ?? []) bridge.callbacks.get(id)?.({ event: "rescan", id, payload: null });
  for (let i = 0; i < 8; i += 1) await tick();
  facts.reached = drawn.sent().some((one) => one.command === "core_call" && one.args.op === ${JSON.stringify(op)} && (one.args.op !== "scan.plan" || one.args.args.mode === "rescan"));
  facts.text = document.querySelector(".window").textContent;
  drawn.dispose();`;

function pageHarness(recording: unknown, body: string): string {
  return `${SHAPE}
import { drawRecording } from ${JSON.stringify(here("../test/look-draw.ts"))};
const recording = ${JSON.stringify(recording)};
const tick = () => new Promise((resolve) => setTimeout(resolve, 60));
const host = document.getElementById("content");
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const unregistered = () => host.querySelectorAll('.scan-row[data-registered="false"]').length;
const encode = (value) => btoa(unescape(encodeURIComponent(JSON.stringify(value))));

(async () => {
  const facts = {};
  ${body}
  document.getElementById("out").textContent = encode(facts);
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;
}

describe("the look root", () => {
  it(
    "a recording rebuilds the Loaded the loader produced",
    async () => {
      const recording = await lookRoot();
      const revived = reviveLoaded(recording.loaded);

      expect(recording.produced.modules.length).toBeGreaterThan(0);
      expect(revived.modules).toEqual(recording.produced.modules);
      expect(JSON.parse(JSON.stringify(revived.findings))).toEqual(
        JSON.parse(JSON.stringify(recording.produced.findings)),
      );
      expect(revived.repository.files.map(({ path }) => path)).toEqual(
        recording.produced.repository.files.map(({ path }) => path),
      );
    },
    scaledTimeout(180000),
  );

  it(
    "a scenario's files and programs shape the recording",
    async () => {
      const recording = await lookRoot({
        files: { [OVERLAY_PATH]: OVERLAY },
        programs: {
          "recognizer-scan-typescript": scanProgram(
            documentOf(["app/one.py", "app/two.py"]),
          ),
        },
      });
      const ids = recording.produced.modules;

      expect(ids.length).toBeGreaterThan(0);
      expect([...ids].sort()).toEqual(["app/one.py", "app/two.py"]);
      expect(
        (recording.produced.overlays ?? []).map(({ name }) => name),
      ).toContain("crap");
    },
    scaledTimeout(180000),
  );

  it(
    "several named recordings are independent",
    async () => {
      const named = await lookRoots({
        first: {
          programs: {
            "recognizer-scan-typescript": scanProgram(documentOf(["a/x.py"])),
          },
        },
        second: {
          programs: {
            "recognizer-scan-typescript": scanProgram(documentOf(["b/y.py"])),
          },
        },
      });

      expect(named.first?.produced.modules).toEqual(["a/x.py"]);
      expect(named.second?.produced.modules).toEqual(["b/y.py"]);
    },
    scaledTimeout(180000),
  );

  it(
    "a mark scopes events and replies",
    async () => {
      const recording = await lookRoot(unregisteredAfter);
      const marks = recording.marks as Record<string, number>;
      const changing = recording.commands.filter((one) => {
        const same = recording.commands.filter(
          (other) =>
            other.command === one.command &&
            JSON.stringify(other.args) === JSON.stringify(one.args),
        );

        return (
          same.some((other) => (other.at ?? 0) <= (marks.first as number)) &&
          same.some(
            (other) =>
              JSON.stringify(other.reply) !== JSON.stringify(same[0]?.reply),
          )
        );
      });

      expect(marks.first).toBeLessThan(marks.second as number);
      expect(changing.length).toBeGreaterThan(0);

      const one = changing[0] as (typeof changing)[number];
      const earlier = answerFor(recording, one.command, one.args, marks.first);
      const later = answerFor(recording, one.command, one.args);

      expect(JSON.stringify(earlier)).not.toEqual(JSON.stringify(later));
    },
    scaledTimeout(180000),
  );

  it(
    "the chosen scan origin is answered to adopt_scan",
    async () => {
      const chosen = { branch: "feature", commit: "def5678" };
      const set = await lookRoot({ origin: chosen });
      const unset = await lookRoot();
      const adopted = (recording: typeof set) =>
        recording.commands.find(({ command }) => command === "adopt_scan")
          ?.reply;

      expect(adopted(set)).toEqual(chosen);
      expect(adopted(unset)).toEqual({ branch: "main", commit: "abc" });
    },
    scaledTimeout(180000),
  );

  const TALLY_ONLY =
    "sensors:\n  tally:\n    manifest: [recognizer-sense-tally, manifest]\n";

  const runTally = (program: ReturnType<typeof sensorProgram>) =>
    lookRoot({
      config: TALLY_ONLY,
      ticks: { ticked: ["tally"] },
      armed: ["tally"],
      programs: { "recognizer-sense-tally": program },
      stages: [
        {
          name: "ran",
          run: async (root) => {
            const host = await untilHolds(
              root.service,
              () => root.view.explorer()?.host,
            );

            host.run(null);

            await untilHolds(root.service, () =>
              host.running() ? true : undefined,
            );

            while (host.running()) {
              await root.service.signal(50);
            }
          },
        },
      ],
    });

  type Ended = { state: string; failure: { reason: string } | null };

  const endedTally = (events: unknown[]): Ended[] =>
    events.flatMap((one) => {
      const plugins =
        (
          one as {
            state?: { run?: { plugins?: (Ended & { name: string })[] } | null };
          }
        ).state?.run?.plugins ?? [];

      return plugins.filter(({ name }) => name === "tally");
    });

  it(
    "a failing program ends the run failed with the diagnosis as its reason",
    async () => {
      const diagnosis = REASONS["crap-no-coverage"];
      const recording = await runTally(
        failingProgram(sensorProgram("tally"), diagnosis),
      );
      const ended = endedTally(recording.events);

      expect(ended.length).toBeGreaterThan(0);
      expect(ended[ended.length - 1]?.state).toBe("failed");
      expect(ended[ended.length - 1]?.failure?.reason).toBe(diagnosis.line);
    },
    scaledTimeout(180000),
  );

  it(
    "a failing program with no diagnosis still ends failed",
    async () => {
      const recording = await runTally(failingProgram(sensorProgram("tally")));
      const ended = endedTally(recording.events);

      expect(ended.length).toBeGreaterThan(0);
      expect(ended[ended.length - 1]?.state).toBe("failed");
      expect(ended[ended.length - 1]?.failure?.reason).not.toBe("");
    },
    scaledTimeout(180000),
  );

  it(
    "ticks and armed reach the root",
    async () => {
      const set = await lookRoot({ ticks: { ticked: [] }, armed: ["tally"] });
      const unset = await lookRoot();
      const reply = (recording: typeof set) =>
        recording.commands.find(({ command }) => command === "read_scan_ticks")
          ?.reply as { ticked: string[] };
      const plan = (recording: typeof set) =>
        recording.commands.find(
          ({ command, args }) =>
            command === "core_call" && args.op === "scan.plan",
        )?.args as { args: { ticks: { armed: string[] } } };

      expect(reply(set).ticked).toEqual([]);
      expect(plan(set).args.ticks.armed).toEqual(["tally"]);
      expect(reply(unset).ticked).toEqual(["crap", "mutation"]);
      expect(plan(unset).args.ticks.armed).toEqual(["crap"]);
    },
    scaledTimeout(180000),
  );

  it(
    "a stopped run is recorded as stopped",
    async () => {
      const gate = new Gate();
      let killed = false;
      let began = false;

      gate.hold();

      const held = heldProgram(sensorProgram("tally"), gate);
      const recording = await lookRoot({
        config: TALLY_ONLY,
        ticks: { ticked: ["tally"] },
        armed: ["tally"],
        programs: {
          "recognizer-sense-tally": (call) => {
            if (call.args[0] !== "run") {
              return held(call);
            }

            began = true;

            return (async () => {
              const result = await held(call);

              killed = call.killed;

              return result;
            })();
          },
        },
        stages: [
          {
            name: "stopped",
            run: async (root) => {
              const host = await untilHolds(
                root.service,
                () => root.view.explorer()?.host,
              );

              host.run(null);

              await untilHolds(root.service, () => (began ? true : undefined));

              host.stop();

              while (host.running()) {
                await root.service.signal(50);
              }
            },
          },
        ],
      });
      const ended = endedTally(recording.events);

      gate.open();

      expect(ended.length).toBeGreaterThan(0);
      expect(ended[ended.length - 1]?.state).toBe("stopped");
      expect(killed).toBe(true);
    },
    scaledTimeout(180000),
  );

  describe.skipIf(webkit === undefined)("in the page", () => {
    let held = null as unknown as { before: number; after: number };
    let disposed = null as unknown as { requests: number; rows: number };
    let carried = null as unknown as { before: number; after: number };
    let facts = null as unknown as { refused: string; served: unknown };
    let gated = null as unknown as { before: number; after: number };
    let readBack = null as unknown as { commands: string[] };
    let delivered = null as unknown as { before: number; after: number };
    let planGaps = null as unknown as GapFacts;
    let startGaps = null as unknown as GapFacts;

    beforeAll(async () => {
      const { produced: _held, ...marked } = await lookRoot(unregisteredAfter);
      disposed = await collectFacts(
        pageHarness(
          marked,
          `const drawn = await drawRecording(host, recording, { until: "first" });
  click(host.querySelector(".rail-scan"));
  await tick();
  drawn.dispose();
  const target = window.__TAURI_INTERNALS__;
  const original = target.invoke;
  facts.requests = 0;
  target.invoke = (...given) => { if (!String(given[0]).startsWith("plugin:event|")) facts.requests += 1; return original(...given); };
  drawn.release("second");
  await tick();
  await tick();
  await tick();
  facts.rows = unregistered();`,
        ),
        "look-root-dispose",
      );
      const { produced: _carried, ...plain } = await lookRoot();

      held = await collectFacts(
        pageHarness(
          marked,
          `const drawn = await drawRecording(host, recording, { until: "first" });
  click(host.querySelector(".rail-scan"));
  await tick();
  facts.before = unregistered();
  drawn.release("second");
  await tick();
  await tick();
  await tick();
  facts.after = unregistered();`,
        ),
        "look-root-mark",
      );
      carried = await collectFacts(
        pageHarness(
          plain,
          `let drawn = await drawRecording(host, recording);
  click(host.querySelector(".rail-scan"));
  await tick();
  facts.before = host.querySelectorAll(".scan-row").length;
  const carry = drawn.explorer().carry();
  drawn.dispose();
  host.replaceChildren();
  drawn = await drawRecording(host, recording, { carried: carry });
  await tick();
  facts.after = host.querySelectorAll(".scan-row").length;`,
        ),
        "look-root-carry",
      );
      const { produced: _gated, ...gatedRecording } = await lookRoot();

      gated = await collectFacts(
        pageHarness(
          gatedRecording,
          `let release = () => {};
  const gate = new Promise((resolve) => { release = resolve; });
  const pending = drawRecording(host, recording, {
    hold: (command, args) => (command === "core_call" && args.op === "scan.start" ? gate : undefined),
  });
  try {
    await tick();
    await tick();
    facts.before = host.querySelectorAll(".rail-scan").length;
  } finally {
    release();
  }
  const drawn = await pending;
  facts.after = host.querySelectorAll(".rail-scan").length;
  drawn.dispose();`,
        ),
        "look-root-held",
      );
      const { produced: _read, ...readRecording } = await lookRoot();

      readBack = await collectFacts(
        pageHarness(
          readRecording,
          `const drawn = await drawRecording(host, recording);
  click(host.querySelector(".rail-scan"));
  await tick();
  facts.commands = drawn.sent().map((one) => one.command === "core_call" ? "core_call:" + one.args.op : one.command);
  drawn.dispose();`,
        ),
        "look-root-sent",
      );
      const { produced: _later, ...laterRecording } = await lookRoot({
        hostEvents: [
          {
            event: "changes-changed",
            payload: {
              files: [{ path: "app/a.py", kind: "modified" }],
              moved: null,
            },
          },
        ],
      });

      delivered = await collectFacts(
        pageHarness(
          laterRecording,
          `const drawn = await drawRecording(host, recording, { hostEvents: "later" });
  click(host.querySelector(".rail-scan"));
  await tick();
  facts.before = drawn.sent().length;
  drawn.deliverHostEvents();
  await tick();
  await tick();
  facts.after = drawn.sent().length;
  drawn.dispose();`,
        ),
        "look-root-later",
      );
      const { produced: _planGaps, ...planGapsRecording } = await lookRoot();

      planGaps = await collectFacts(
        pageHarness(planGapsRecording, gapsDraw("scan.plan")),
        "look-root-plan-gaps",
      );

      const { produced: _startGaps, ...startGapsRecording } = await lookRoot();

      startGaps = await collectFacts(
        pageHarness(startGapsRecording, gapsDraw("scan.start")),
        "look-root-start-gaps",
      );

      const { produced: _produced, ...recording } = await lookRoot({
        answers: { "nonesuch.op": { ok: 7 } },
      });

      facts = await collectFacts(harness(recording), "look-root");
    }, scaledTimeout(540000));

    it("a draw released only up to a mark serves no later event", () => {
      expect(held.before).toBe(0);
      expect(held.after).toBeGreaterThan(0);
    });

    it("a disposed draw makes no further requests", () => {
      expect(disposed.requests).toBe(0);
      expect(disposed.rows).toBe(0);
    });

    it("a drawn explorer's carry is handed to the next draw", () => {
      expect(carried.before).toBeGreaterThan(0);
      expect(carried.after).toBeGreaterThan(0);
    });

    it("a held reply is served only when released", () => {
      expect(gated.before).toBe(0);
      expect(gated.after).toBeGreaterThan(0);
    });

    it("the page's own commands are read back", () => {
      expect(readBack.commands.length).toBeGreaterThan(0);
      expect(readBack.commands).toContain("core_call:scan.plan");
    });

    it("host events delivered on demand reach the page after the first read", () => {
      expect(delivered.after).toBeGreaterThan(delivered.before);
    });

    it("a command with no recorded answer fails naming the command", () => {
      expect(facts.refused).toContain("nonesuch");
      expect(facts.refused).toContain('{"a":1}');
    });

    it("a gaps reply to the plan call shows the gap line and no JSON", () => {
      expect(planGaps.reached).toBe(true);
      expect(planGaps.text).toContain("crap needs coverage");
      expect(planGaps.text).not.toContain('{"kind"');
      expect(planGaps.text).not.toContain('"gaps":');
    });

    it("a gaps reply to the start call shows the gap line and no JSON", () => {
      expect(startGaps.reached).toBe(true);
      expect(startGaps.text).toContain("crap needs coverage");
      expect(startGaps.text).not.toContain('{"kind"');
      expect(startGaps.text).not.toContain('"gaps":');
    });

    it("a declared answer is served after the first draw", () => {
      expect(facts.served).toEqual({ ok: 7 });
    });
  });
});
