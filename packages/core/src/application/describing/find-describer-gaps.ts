import type { Gap } from "../../domain/gap.js";
import type { DescribingPorts } from "./internal/describing-ports.js";
import type { LocatedDescriber } from "./ports/describer.js";

export interface FindDescriberGapsInput {
  root: string;
  describe: boolean;
  located: LocatedDescriber;
  install: Record<string, string>;
}

export function findDescriberGaps(
  ports: DescribingPorts,
  input: FindDescriberGapsInput,
): Gap[] {
  return ports.describer.gaps({
    root: input.root,
    describe: input.describe,
    describer: input.located.describer,
    install: input.install,
  });
}
