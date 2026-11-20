import type { ConfigDocument } from "../../domain/config-document.js";
import type { SensingPorts } from "./internal/sensing-ports.js";

export function readRunConfig(
  ports: SensingPorts,
  root: string,
  skipRetired: boolean,
): ConfigDocument | null {
  return ports.store.runConfig(root, skipRetired);
}
