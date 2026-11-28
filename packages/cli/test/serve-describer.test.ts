import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scaledTimeout } from "../../../tools/scripts/pool-scale.mjs";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { installFakeDescriber } from "./fake-describer-shim.js";
import { Serve } from "./serve-harness.js";

const TIMEOUT = scaledTimeout(60_000);

function repositoryWith(files: Record<string, string>): string {
  const root = makeTempDir("recognizer-serve-describer-");

  mkdirSync(join(root, ".recognizer"), { recursive: true });

  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(root, ".recognizer", name), text);
  }

  return root;
}

describe("recognizer serve: describer.read", () => {
  it(
    "replies with the registered describer's command and version",
    async () => {
      const repository = repositoryWith({});
      const { directory, program } = installFakeDescriber(repository, "v7");
      const serve = new Serve(directory);
      const reply = await serve.call("describer.read", { repository });

      expect(reply.ok).toEqual({
        command: [program, "run", "--model", "{model}", "{request}"],
        version: "v7",
      });

      await serve.close();
    },
    TIMEOUT,
  );

  it(
    "replies with the use case's message when the responsibilities file is invalid",
    async () => {
      const repository = repositoryWith({
        "responsibilities.json": "{}",
      });
      const serve = new Serve(makeTempDir("recognizer-serve-empty-path-"));
      const reply = await serve.call("describer.read", { repository });

      expect(reply.ok).toBeUndefined();
      expect(String(reply.error)).toMatch(/^responsibilities/);

      await serve.close();
    },
    TIMEOUT,
  );
});
