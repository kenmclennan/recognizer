import { discoverPlugins } from "@recognizer/core";
import { PublishedLanguagesAdapter } from "./adapters/plugins/published-languages-adapter.js";
import type { Io } from "./cli.js";
import { manifestPorts } from "./manifest-ports.js";

export function installedLanguages(io: Io): PublishedLanguagesAdapter {
  return new PublishedLanguagesAdapter(
    () => discoverPlugins(manifestPorts(io), ["scanner"]).plugins,
  );
}
