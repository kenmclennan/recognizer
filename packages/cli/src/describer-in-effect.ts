import { readManifestOf } from "@recognizer/core";
import { shippedDescriberInvocation } from "./adapters/plugins/shipped-plugins-adapter.js";
import type { Io } from "./cli.js";
import { readConfig } from "./config.js";
import type { Describer } from "./describe-modules.js";
import { describerVersion } from "./describer-version.js";
import { InputError } from "./errors.js";
import { manifestPorts } from "./manifest-ports.js";

export { describerVersion };

export interface DescriberInEffect extends Describer {
  source: "config" | "shipped";
}

export function describerInEffect(io: Io, root: string): DescriberInEffect {
  const found = findDescriber(io, root);

  if (found === null) {
    throw new InputError([NONE_REGISTERED]);
  }

  return found;
}

const NONE_REGISTERED =
  "no describer is registered: add one to .recognizer/config.yaml and recognizer-describe-claude is not installed";

export function findDescriber(io: Io, root: string): DescriberInEffect | null {
  const configured = readConfig(io, root, ["describer"])?.describer;

  if (configured !== undefined) {
    return {
      ...configured,
      version: describerVersion(configured),
      source: "config",
    };
  }

  const invocation = shippedDescriberInvocation();
  const read = readManifestOf(manifestPorts(io), [invocation[0] as string]);
  const version =
    read.ok && read.manifest.prompt_version !== undefined
      ? read.manifest.prompt_version
      : "";

  if (version === "") {
    return null;
  }

  const shipped = { command: invocation, version };

  return {
    ...shipped,
    version: describerVersion(shipped),
    source: "shipped",
  };
}
