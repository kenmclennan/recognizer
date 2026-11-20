import type { PluginLimits } from "./opaque.js";

export interface ProcessControl {
  limits(root: string): PluginLimits;
  stopAll(): Promise<void>;
}
