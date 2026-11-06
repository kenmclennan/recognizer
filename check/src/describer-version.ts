import type { Describer } from "./describe-modules.js";

export function describerVersion(describer: Describer): string {
  return describer.version;
}
