import type { Io } from "./cli.js";
import { readConfig } from "./config.js";
import type { Describer } from "./describe-modules.js";
import { describerVersion } from "./describer-version.js";
import { InputError } from "./errors.js";
import { SHIPPED_DESCRIBER_COMMAND } from "./shipped-describer.js";

export { describerVersion };

export interface DescriberInEffect extends Describer {
  source: "config" | "shipped";
}

export function describerInEffect(io: Io, root: string): DescriberInEffect {
  const configured = readConfig(io, root)?.describer;

  if (configured !== undefined) {
    return {
      ...configured,
      version: describerVersion(configured),
      source: "config",
    };
  }

  const run = io.run(SHIPPED_DESCRIBER_COMMAND[0] as string, [
    "--prompt-version",
  ]);
  const version = run.started && run.status === 0 ? firstLine(run.stdout) : "";

  if (version === "") {
    throw new InputError([
      "no describer is registered: add one to .recognizer/config.yaml and recognizer-describe-claude is not installed",
    ]);
  }

  const shipped = { command: [...SHIPPED_DESCRIBER_COMMAND], version };

  return {
    ...shipped,
    version: describerVersion(shipped),
    source: "shipped",
  };
}

function firstLine(text: string): string {
  return (text.split("\n")[0] ?? "").trim();
}
