import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../../tools/scripts/pool-scale.mjs";
import { sensorProgram } from "../../../cli/test/support/index";
import { collectFacts, FAKE_WORKER, here, webkit } from "../../src/look-page";
import { untilHolds } from "../app-harness";
import { appSensor } from "../in-process-root";
import { Gate, heldProgram, lookRoot, scanProgram } from "../look-root";

const SCAN_COMMIT = "0123456789abcdef0123456789abcdef01234567";
const HASH = "1".repeat(64);
const IDS = ["app/risk.py", "src/other.ts", "lib/none.py"];

const example = JSON.parse(
  readFileSync(
    here("../../../schema/overlay-examples/valid/crap.json"),
    "utf8",
  ),
);
const overlay = JSON.stringify({
  ...example,
  commit: SCAN_COMMIT,
  inputs: { "app/risk.py": HASH, "src/other.ts": HASH, "lib/none.py": HASH },
});
const scan = {
  commit: SCAN_COMMIT,
  modified: false,
  files: IDS.map((id) => ({ path: id, hash: HASH })),
  modules: IDS.map((id) => ({ id, kind: "module" })),
  edges: [{ from: IDS[0], to: IDS[1], kind: "depends", line: 1, names: ["X"] }],
  foreign: [],
};
const CONFIG = [
  "sensors:",
  "  crap:",
  "    manifest: [recognizer-sense-crap, manifest]",
  "  mutation:",
  "    manifest: [recognizer-sense-mutation, manifest]",
  "  tally:",
  "    manifest: [recognizer-sense-tally, manifest]",
  "",
].join("\n");

const HARNESS = (recording: unknown) => `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { drawRecording } from ${JSON.stringify(here("../test/look-draw.ts"))};
${FAKE_WORKER}

const recording = ${JSON.stringify(recording)};
const tick = () => new Promise((resolve) => setTimeout(resolve, 60));
const host = document.getElementById("content");
const qa = (selector) => [...host.querySelectorAll(selector)];
const facts = {};
const panel = () => ({
  rows: qa(".scan-row:not(.scan-suite)").map((r) => ({ key: r.dataset.sensor, name: r.querySelector(".scan-row-label").textContent })),
  controls: qa(".controls .control").map((b) => b.textContent),
});

(async () => {
  let drawn = await drawRecording(host, recording, { until: "idle" });
  await tick();
  drawn.release("running");
  await tick();
  await tick();
  facts.before = panel();

  const carried = drawn.explorer().carry();
  drawn.dispose();
  host.replaceChildren();
  drawn = await drawRecording(host, recording, { until: "idle", carried });
  await tick();
  drawn.release("running");
  await tick();
  await tick();
  facts.after = panel();

  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Facts = ReturnType<typeof JSON.parse>;

describe.skipIf(webkit === undefined)(
  "the Scan panel over a repository snapshot",
  () => {
    let f = null as unknown as Facts;
    let overlayNames = [] as string[];

    beforeAll(async () => {
      const gate = new Gate();

      gate.hold();

      const { produced, ...recording } = await lookRoot({
        config: CONFIG,
        files: {
          ".recognizer/cache/overlays/crap.json": overlay,
        },
        programs: {
          "recognizer-scan-typescript": scanProgram(scan),
          "recognizer-sense-tally": sensorProgram("tally"),
          "recognizer-sense-mutation": heldProgram(
            appSensor("mutation", true, false, () => HASH),
            gate,
          ),
        },
        stages: [
          { name: "idle", run: async () => {} },
          {
            name: "running",
            run: async (root) => {
              const host = await untilHolds(
                root.service,
                () => root.view.explorer()?.host,
              );

              host.run(null);

              await untilHolds(root.service, () =>
                host.running() ? true : undefined,
              );
            },
          },
        ],
      });

      overlayNames = (produced.overlays ?? []).map((one) => one.name);
      f = await collectFacts<Facts>(
        HARNESS(recording),
        "scan-panel-state-look",
      );
      gate.open();
    }, scaledTimeout(180000));

    it("rows_and_overlay_survive_an_explorer_replace_mid_run", () => {
      const named = (rows: { key: string }[]) =>
        rows
          .map((row) => row.key)
          .filter((key) => ["crap", "mutation", "tally"].includes(key));

      expect(named(f.before.rows).sort()).toEqual([
        "crap",
        "mutation",
        "tally",
      ]);
      expect(f.before.controls).toContain("Metrics");
      expect(overlayNames).toContain("crap");
      expect(named(f.after.rows)).toEqual(named(f.before.rows));
      expect(f.after.rows).toEqual(f.before.rows);
      expect(f.after.controls).toContain("Metrics");
    });
  },
);
