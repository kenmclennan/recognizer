import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../tools/scripts/pool-scale.mjs";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { Serve, typescriptLaunchers } from "./serve-harness.js";

const TIMEOUT = scaledTimeout(120_000);

const hashOf = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");

describe("serve config", () => {
  it(
    "config.write returns written for a valid edit and refused with the key for an invalid one",
    async () => {
      const serve = new Serve(typescriptLaunchers());
      const repository = makeTempDir("serve-config-repo-");
      const file = join(repository, ".recognizer/config.yaml");

      try {
        const written = await serve.call("config.write", {
          repository,
          baseHash: hashOf(""),
          edits: [{ op: "set", key: "describer.version", value: "1" }],
        });

        expect(written.ok.status).toBe("written");
        expect(readFileSync(file, "utf8")).toBe(written.ok.text);
        expect(written.ok.text).toContain("version");

        const refused = await serve.call("config.write", {
          repository,
          baseHash: hashOf(written.ok.text),
          edits: [
            { op: "set", key: "describer.version", value: "2" },
            { op: "set", key: "nope", value: "1" },
          ],
        });

        expect(refused.ok).toMatchObject({ status: "refused", key: "nope" });
        expect(readFileSync(file, "utf8")).toBe(written.ok.text);

        const stale = await serve.call("config.write", {
          repository,
          baseHash: hashOf(""),
          edits: [{ op: "set", key: "describer.version", value: "3" }],
        });

        expect(stale.ok).toEqual({
          status: "changed",
          reason: "the config changed since it was read",
        });
      } finally {
        await serve.close();
      }
    },
    TIMEOUT,
  );

  it(
    "config.write refuses a key that is not a config key without writing",
    async () => {
      const serve = new Serve(typescriptLaunchers());
      const repository = makeTempDir("serve-config-bad-");

      try {
        const reply = await serve.call("config.write", {
          repository,
          baseHash: hashOf(""),
          edits: [{ op: "set", key: "a/b", value: "1" }],
        });

        expect(reply.ok).toEqual({
          status: "refused",
          key: "a/b",
          reason: "a/b is not a config key",
        });
        expect(existsSync(join(repository, ".recognizer/config.yaml"))).toBe(
          false,
        );
      } finally {
        await serve.close();
      }
    },
    TIMEOUT,
  );

  it(
    "config.keys returns the schema",
    async () => {
      const serve = new Serve(typescriptLaunchers());

      try {
        const reply = await serve.call("config.keys", {
          repository: makeTempDir("serve-config-keys-"),
        });

        expect(reply.ok.status).toBe("ok");
        expect(reply.ok.schema.keys_version).toBe(1);
        expect(
          reply.ok.schema.keys.some(
            (entry: { key: string }) => entry.key === "sensors.crap.threshold",
          ),
        ).toBe(true);
      } finally {
        await serve.close();
      }
    },
    TIMEOUT,
  );
});
