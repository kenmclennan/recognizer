import type { DescribingPorts } from "./internal/describing-ports.js";

export interface DescribingSettings {
  model: string;
  batchSize: number;
}

export function describingSettings(ports: DescribingPorts): DescribingSettings {
  return ports.describer.settings();
}
