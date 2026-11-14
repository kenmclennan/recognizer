import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { configHash } from "./config-hash";
import { fakeSettingsModal } from "./settings-modal-fake";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const SCHEMA = JSON.parse(
  readFileSync(join(REPO, "fixtures/sensors/config-keys.json"), "utf8"),
);

const BASE = "sensors:\n  crap:\n    threshold: 30 # keep\n";

describe("the settings modal port fake", () => {
  it("applies a valid edit through the real setValue", async () => {
    const fake = fakeSettingsModal({ config: BASE, schema: SCHEMA });
    const result = await fake.writeRepositoryConfig(
      [{ op: "set", key: "sensors.crap.threshold", value: "25" }],
      await configHash(BASE),
    );

    expect(result.status).toBe("written");
    expect(fake.config).toContain("threshold: 25");
    expect(fake.config).toContain("# keep");
  });

  it("refuses an out-of-bound value with the CLI's own message and keeps its text", async () => {
    const fake = fakeSettingsModal({ config: BASE, schema: SCHEMA });
    const result = await fake.writeRepositoryConfig(
      [
        { op: "set", key: "sensors.crap.threshold", value: "25" },
        { op: "set", key: "sensors.crap.threshold", value: "-1" },
      ],
      await configHash(BASE),
    );

    expect(result).toMatchObject({
      status: "refused",
      key: "sensors.crap.threshold",
    });
    expect((result as { reason: string }).reason).toContain("above 0");
    expect(fake.config).toBe(BASE);
  });

  it("refuses a changed config before applying anything", async () => {
    const fake = fakeSettingsModal({ config: BASE, schema: SCHEMA });
    const result = await fake.writeRepositoryConfig(
      [{ op: "set", key: "sensors.crap.threshold", value: "25" }],
      await configHash("other: 1\n"),
    );

    expect(result).toEqual({
      status: "changed",
      reason: "the config changed since it was read",
    });
    expect(fake.config).toBe(BASE);
  });

  it("round-trips the setup model with the other settings", async () => {
    const fake = fakeSettingsModal();

    expect((await fake.readSettings()).setup).toEqual({ model: "sonnet" });

    await fake.writeSettings({
      editor: "code",
      describing: { model: "haiku", batchSize: 4, confirmAboveUsd: 5 },
      setup: { model: "opus" },
    });

    expect(await fake.readSettings()).toEqual({
      editor: "code",
      describing: { model: "haiku", batchSize: 4, confirmAboveUsd: 5 },
      setup: { model: "opus" },
    });
  });
});
