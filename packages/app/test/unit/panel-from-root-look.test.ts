import { beforeAll, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../../tools/scripts/pool-scale.mjs";
import { collectFacts, FAKE_WORKER, here, webkit } from "../../src/look-page";
import { appRoot, untilHolds } from "../roots";

const SCAN = `{
  commit: "cur1234",
  modules: [{ id: "api/src/a.ts", kind: "module", members: [{ name: "f", exported: true, kind: "function" }] }],
  edges: [],
  foreign: [],
  files: [{ path: "api/src/a.ts", hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }],
}`;

function harness(recorded: unknown): string {
  return `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { loadedOf, mountExplorer, scanHostOf } from ${JSON.stringify(here("../test/unit/look-support.ts"))};
import { fakeSensors } from ${JSON.stringify(here("sensors-fake.ts"))};
${FAKE_WORKER}

const recorded = ${JSON.stringify(recorded)};
const tick = () => new Promise((resolve) => setTimeout(resolve, 60));

(async () => {
  const sensors = fakeSensors({}, { config: recorded.config }, {}, recorded.installed);
  const container = document.createElement("div");
  container.style.cssText = "width:1400px;height:700px;display:flex;flex-direction:column";
  document.body.append(container);

  const loaded = loadedOf({ modules: ["api/src/a.ts"], scans: [{ file: "scan.typescript.json", scan: ${SCAN} }] });

  mountExplorer({ container, loaded, title: "demo", scanHost: scanHostOf({ port: sensors }) });
  container.querySelector(".rail-scan").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  await tick();
  await tick();

  const rows = [...container.querySelectorAll(".scan-row")].map((node) => ({ sensor: node.dataset.sensor, registered: node.dataset.registered }));
  const facts = { rows };

  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
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
      const root = await appRoot({ config: "sensors:\n  crap: {}\n" });
      const host = await untilHolds(
        root.service,
        () => root.view.explorer()?.host,
      );

      for (;;) {
        const rows = await root.view.rows();

        if (rows.length === 2) {
          recordedRows = rows;
          break;
        }

        await root.service.signal(50);
      }

      const recorded = {
        config: (await host.port.inputs()).configText,
        installed: await host.port.sensorList(),
      };

      facts = await collectFacts<Facts>(harness(recorded), "panel-from-root");
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
