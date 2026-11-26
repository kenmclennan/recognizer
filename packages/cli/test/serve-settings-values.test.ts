import { readFileSync } from "node:fs";
import { join } from "node:path";
import { machineSetting } from "@recognizer/core";
import { describe, expect, it } from "vitest";
import { REPO } from "./helpers.js";
import { serveRoot } from "./support/serve-root.js";

const batch = machineSetting("describing.batch_size");
const spend = machineSetting("describing.confirm_above_usd");
const setup = machineSetting("setup.model");

function describerRoot() {
  const manifest = JSON.parse(
    readFileSync(
      join(REPO, "schema/manifest-examples/valid/describer.json"),
      "utf8",
    ),
  );

  manifest.name = "fake";
  manifest.settings[0].default = "fake-default";

  let reads = 0;
  const root = serveRoot({
    programs: {
      "recognizer-describe-fake": (call) => {
        if (call.args[0] === "manifest") {
          reads += 1;
        }

        return {
          started: true,
          status: 0,
          stdout: JSON.stringify(manifest),
          stderr: "",
        };
      },
    },
  });

  return { root, reads: () => reads };
}

describe("recognizer serve: settings.values", () => {
  it("never reads a manifest without with_model_default", async () => {
    const { root, reads } = describerRoot();
    const reply = await root.call("settings.values", {
      describing: {},
      setup: {},
      with_model_default: false,
    });

    expect(reply.ok).toEqual({
      problem: null,
      values: {
        describing: {
          model: null,
          batch_size: batch.default,
          confirm_above_usd: spend.default,
        },
        setup: { model: setup.default },
      },
    });
    expect(reads()).toBe(0);

    await root.close();
  });

  it("replies with the published model default when none is stored", async () => {
    const { root, reads } = describerRoot();
    const reply = await root.call("settings.values", {
      describing: { batch_size: 9 },
      with_model_default: true,
    });

    expect(reply.ok.values.describing).toEqual({
      model: "fake-default",
      batch_size: 9,
      confirm_above_usd: spend.default,
    });
    expect(reads()).toBe(1);

    await root.close();
  });

  it("keeps a stored model without reading a manifest", async () => {
    const { root, reads } = describerRoot();
    const reply = await root.call("settings.values", {
      describing: { model: "mine" },
      with_model_default: true,
    });

    expect(reply.ok.values.describing.model).toBe("mine");
    expect(reads()).toBe(0);

    await root.close();
  });

  it("replies the problem for a bad stored value", async () => {
    const { root } = describerRoot();
    const reply = await root.call("settings.values", {
      describing: { batch_size: (batch.maximum as number) + 1 },
      with_model_default: true,
    });

    expect(reply.ok.problem).toMatch(/^describing\.batch_size/);
    expect(reply.ok.values).toBeNull();

    await root.close();
  });
});
