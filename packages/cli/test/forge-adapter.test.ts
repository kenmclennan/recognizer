import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { ForgeAdapter } from "../src/adapters/git/forge-adapter.js";
import { type Io, nodeIo } from "../src/cli.js";

function ioWithPath(path: string): Io {
  const base = nodeIo();

  return {
    ...base,
    runAsync: (command, args, options) =>
      base.runAsync(command, args, { ...options, env: { PATH: path } }),
  };
}

function stub(body: string): string {
  const bin = makeTempDir("recognizer-forge-bin-");
  const file = join(bin, "gh");

  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);

  return bin;
}

describe("ForgeAdapter", () => {
  it("runs the program named gh from a directory it is given and reports its output", async () => {
    const bin = stub('pwd\necho "$1" >&2\nexit 3');
    const cwd = makeTempDir("recognizer-forge-cwd-");
    const result = await new ForgeAdapter(ioWithPath(bin)).run(
      cwd,
      ["pr", "list"],
      10_000,
    );

    expect(result.started).toBe(true);
    expect(result.status).toBe(3);
    expect(result.stdout.trim().endsWith(cwd.split("/").pop() as string)).toBe(
      true,
    );
    expect(result.stderr.trim()).toBe("pr");
  });

  it("reports started false when gh is not on the path", async () => {
    const empty = makeTempDir("recognizer-forge-empty-");
    const result = await new ForgeAdapter(ioWithPath(empty)).run(
      empty,
      [],
      10_000,
    );

    expect(result.started).toBe(false);
  });

  it("stops gh after the timeout it is given", async () => {
    const bin = stub("sleep 5");
    const cwd = makeTempDir("recognizer-forge-cwd-");
    const result = await new ForgeAdapter(
      ioWithPath(`${bin}:/bin:/usr/bin`),
    ).run(cwd, [], 200);

    expect(result.timedOut).toBe(true);
  });
});
