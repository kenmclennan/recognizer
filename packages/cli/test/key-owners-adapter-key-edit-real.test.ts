import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../tools/scripts/pool-scale.mjs";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { nodeIo } from "../src/cli.js";
import { configurationFor } from "../src/configuration-composition.js";
import { REPO } from "./helpers.js";
import { isolatedPath } from "./isolated-path.js";
import { typescriptLaunchers } from "./serve-harness.js";

const TIMEOUT = scaledTimeout(120_000);

function configurationOver() {
  return configurationFor(nodeIo(), {
    environment: {
      PATH: isolatedPath(typescriptLaunchers()),
    },
  });
}

describe("key edits over committed content", () => {
  it(
    "readKeySchema answers and editKey lists this repository's own config with no skipped path",
    () => {
      const configuration = configurationOver();

      expect(configuration.readKeySchema().status).toBe("ok");

      const listing = configuration.editKey({
        subject: "config",
        root: REPO,
        verb: "list",
        key: "",
      });

      expect(listing.status).toBe("ok");
      expect(listing).not.toHaveProperty("paths");
    },
    TIMEOUT,
  );

  it(
    "editKey lists the hexagonal policy template with no skipped path (non-gating)",
    () => {
      const root = makeTempDir("key-edit-real-");

      mkdirSync(join(root, ".recognizer"), { recursive: true });
      cpSync(
        join(REPO, "docs/policies/hexagonal.yaml"),
        join(root, ".recognizer/policy.yaml"),
      );

      const listing = configurationOver().editKey({
        subject: "policy",
        root,
        verb: "list",
        key: "",
      });

      expect(listing.status).toBe("ok");
      expect(listing).not.toHaveProperty("paths");
    },
    TIMEOUT,
  );
});
