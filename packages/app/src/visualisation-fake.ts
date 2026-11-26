import { parseViewFile, serialiseView } from "./view-file";
import type { VisualisationPort } from "./visualisation-port";

export function createVisualisationFake(): VisualisationPort {
  return {
    parse: (text) => Promise.resolve(parseViewFile(text)),
    serialise: (view) => Promise.resolve(serialiseView(view)),
  };
}
