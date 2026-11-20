import type { LocatedDescriber } from "./ports/describer.js";

export function isDescriberRegistered(located: LocatedDescriber): boolean {
  return located.describer !== null;
}
