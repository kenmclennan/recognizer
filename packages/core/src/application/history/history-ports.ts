import type { Limiter } from "../shared/limiter.js";
import type { Git } from "../shared/ports/git.js";
import type { Forge } from "./ports/forge.js";

export interface HistoryPorts {
  readonly git: Git;
  readonly forge: Forge;
  readonly limiter: Limiter;
}
