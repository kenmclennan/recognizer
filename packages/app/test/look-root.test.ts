import { beforeAll, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../tools/scripts/pool-scale.mjs";
import { collectFacts, FAKE_WORKER, here, webkit } from "../src/look-page";
import { answerFor, reviveLoaded } from "./look-recording";
import {
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

  describe.skipIf(webkit === undefined)("in the page", () => {
    let held = null as unknown as { before: number; after: number };
    let carried = null as unknown as { before: number; after: number };
    let facts = null as unknown as { refused: string; served: unknown };

    beforeAll(async () => {
      const { produced: _held, ...marked } = await lookRoot(unregisteredAfter);
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
      const { produced: _produced, ...recording } = await lookRoot({
        answers: { "nonesuch.op": { ok: 7 } },
      });

      facts = await collectFacts(harness(recording), "look-root");
    }, scaledTimeout(540000));

    it("a draw released only up to a mark serves no later event", () => {
      expect(held.before).toBe(0);
      expect(held.after).toBeGreaterThan(0);
    });

    it("a drawn explorer's carry is handed to the next draw", () => {
      expect(carried.before).toBeGreaterThan(0);
      expect(carried.after).toBeGreaterThan(0);
    });

    it("a command with no recorded answer fails naming the command", () => {
      expect(facts.refused).toContain("nonesuch");
      expect(facts.refused).toContain('{"a":1}');
    });

    it("a declared answer is served after the first draw", () => {
      expect(facts.served).toEqual({ ok: 7 });
    });
  });
});
