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
const tick = () => new Promise((resolve) => setTimeout(resolve, 60));

(async () => {
  const container = document.getElementById("content");

  await drawRecording(container, recording);
  await tick();
  container.querySelector(".rail-scan").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  await tick();
  await tick();

  const rows = [...container.querySelectorAll(".scan-row")].map((node) => ({ sensor: node.dataset.sensor, registered: node.dataset.registered }));

  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify({ rows }))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;
}

type Facts = { rows: { sensor: string; registered: string }[] };

describe.skipIf(webkit === undefined)(
  "the panel drawn from a recorded model",
  () => {
    let facts = null as unknown as Facts;
    let recordedRows = [] as { name: string; registered: boolean }[];

    beforeAll(async () => {
      const { produced: _produced, ...recording } = await lookRoot({
        config: "sensors:\n  crap: {}\n",
        warm: async (root) => {
          for (;;) {
            const rows = await root.view.rows();

            if (rows.length === 2) {
              recordedRows = rows;
              break;
            }

            await root.service.signal(50);
          }
        },
      });

      facts = await collectFacts<Facts>(harness(recording), "panel-from-root");
    }, scaledTimeout(180000));

    it("the unregistered-sensors line renders from a model the root recorded", () => {
      const unregistered = recordedRows
        .filter(({ registered }) => registered !== true)
        .map(({ name }) => name);

      expect(unregistered).toEqual(["mutation"]);
      expect(
        facts.rows
          .filter(({ registered }) => registered === "false")
          .map(({ sensor }) => sensor),
      ).toEqual(unregistered);
    });
  },
);
