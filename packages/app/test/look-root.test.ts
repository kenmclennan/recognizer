import { beforeAll, describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../tools/scripts/pool-scale.mjs";
import { collectFacts, FAKE_WORKER, here, webkit } from "../src/look-page";
import { reviveLoaded } from "./look-recording";
import { lookRoot } from "./look-root";

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

  describe.skipIf(webkit === undefined)("in the page", () => {
    let facts = null as unknown as { refused: string; served: unknown };

    beforeAll(async () => {
      const { produced: _produced, ...recording } = await lookRoot({
        answers: { "nonesuch.op": { ok: 7 } },
      });

      facts = await collectFacts(harness(recording), "look-root");
    }, scaledTimeout(180000));

    it("a command with no recorded answer fails naming the command", () => {
      expect(facts.refused).toContain("nonesuch");
      expect(facts.refused).toContain('{"a":1}');
    });

    it("a declared answer is served after the first draw", () => {
      expect(facts.served).toEqual({ ok: 7 });
    });
  });
});
