import { beforeAll, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../../tools/scripts/pool-scale.mjs";
import { sensorManifest } from "../../../cli/test/support/index";
import { collectFacts, FAKE_WORKER, here, webkit } from "../../src/look-page";
import { digestOf, lookRoot, scanProgram } from "../look-root";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const A_TEXT = "def f():\n    return 1\n";
const HASH = digestOf(A_TEXT);
const IDS = ["app/a.py", "app/b.py"];

const scan = {
  commit: COMMIT,
  modified: false,
  files: IDS.map((path) => ({ path, hash: HASH })),
  modules: IDS.map((id) => ({ id, kind: "module" })),
  edges: [],
  foreign: [],
};
const findings = JSON.stringify({
  findings_version: 2,
  sensor: { name: "crap", version: "0.1.0" },
  commit: COMMIT,
  modified: false,
  settings: {},
  inputs: Object.fromEntries(IDS.map((id) => [id, HASH])),
  findings: [
    {
      id: "risk:a",
      kind: "crap",
      severity: "violation",
      principle: "change-risk-anti-patterns",
      summary: "too risky",
      evidence: { modules: ["app/a.py"] },
    },
  ],
});
const CONFIG =
  "sensors:\n  crap:\n    manifest: [recognizer-sense-crap, manifest]\n";

const published = (JSON.parse(sensorManifest("crap")).principles ?? []) as {
  id: string;
  name: string;
}[];
const name = published.find(
  (one) => one.id === "change-risk-anti-patterns",
)?.name;

const HARNESS = (recording: unknown) => `
window.addEventListener("error", (e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + (e.error && e.error.stack)); });
import { drawRecording } from ${JSON.stringify(here("../test/look-draw.ts"))};
${FAKE_WORKER}

const recording = ${JSON.stringify(recording)};
const tick = () => new Promise((resolve) => setTimeout(resolve, 80));
const click = (node) => node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const host = document.getElementById("content");
const q = (selector) => host.querySelector(selector);

(async () => {
  await drawRecording(host, recording);
  await tick();
  click(q('.tree .row[data-path="app"] .name'));
  await tick();
  const facts = { hover: q('.tree .row[data-path="app/a.py"] .disc').title };
  document.getElementById("out").textContent = btoa(unescape(encodeURIComponent(JSON.stringify(facts))));
})().catch((e) => { document.getElementById("out").textContent = btoa("ERR " + e.message + " " + e.stack); });
`;

type Facts = { hover: string };

describe.skipIf(webkit === undefined)("the health hover line", () => {
  let f = null as unknown as Facts;

  beforeAll(async () => {
    const { produced: _, ...recording } = await lookRoot({
      config: CONFIG,
      files: {
        ".recognizer/cache/findings/crap.json": findings,
        "app/a.py": A_TEXT,
        "app/b.py": A_TEXT,
      },
      programs: { "recognizer-scan-typescript": scanProgram(scan) },
    });

    f = await collectFacts<Facts>(
      HARNESS(recording),
      "explorer-health-principles",
    );
  }, scaledTimeout(180000));

  it("the_hover_line_shows_the_published_name_after_the_sensor_list_arrives", () => {
    expect(name).toBeDefined();
    expect(f.hover).toContain(name);
    expect(f.hover).not.toContain("change-risk-anti-patterns");
  });
});
