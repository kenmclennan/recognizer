import type { Prices } from "../../domain/describing/describe-projection.js";
import type { DescribingPorts } from "./internal/describing-ports.js";
import type { DescriberRef } from "./ports/describer-ref.js";

export interface DescribingSettings {
  model: string;
  batchSize: number;
  prices: Prices | undefined;
}

export function describingSettings(
  ports: DescribingPorts,
  describer: DescriberRef,
  root: string,
): DescribingSettings {
  return ports.describer.settings(describer, root);
}
