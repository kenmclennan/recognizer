import type { Describer } from "./describe-modules.js";

export function describerVersion(describer: Describer, model: string): string {
  return describer.command.some((item) => item.includes("{model}"))
    ? `${describer.version}+${model}`
    : describer.version;
}
