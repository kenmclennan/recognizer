import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir } from "../../../tools/scripts/temp-dirs.mjs";
import { REPO } from "./helpers.js";
import { linkRegistryFolder, registerShim } from "./plugin-registry-shim.js";

const FAKE = join(REPO, "packages/cli/test/fixtures/fake-describer.mjs");

export interface FakeDescriberShim {
  directory: string;
  program: string;
}

export function installFakeDescriber(
  repository: string,
  version = "1",
  flags: readonly string[] = [],
  existing?: string,
): FakeDescriberShim {
  const directory = existing ?? makeTempDir("recognizer-describer-shim-");
  const program = join(directory, "recognizer-describe-fake");
  const environment = [
    `FAKE_PROMPT_VERSION=${JSON.stringify(version)}`,
    `FAKE_REPOSITORY=${JSON.stringify(repository)}`,
    `FAKE_FLAGS=${JSON.stringify(JSON.stringify(flags))}`,
  ].join(" ");

  writeFileSync(
    program,
    `#!/bin/sh\n${environment} exec ${JSON.stringify(process.execPath)} ${JSON.stringify(FAKE)} "$@"\n`,
  );
  chmodSync(program, 0o755);
  registerShim(program);

  const registry = process.env.RECOGNIZER_PLUGIN_DIRS?.replace(/^:/, "");

  if (registry !== undefined && registry !== "") {
    linkRegistryFolder(directory, registry);
  }

  return { directory, program };
}
