import { installedScanners } from "./adapters/plugins/installed-scanners.js";
import { PublishedLanguagesAdapter } from "./adapters/plugins/published-languages-adapter.js";
import type { Io } from "./cli.js";

export function installedLanguages(io: Io): PublishedLanguagesAdapter {
  return new PublishedLanguagesAdapter(() => installedScanners(io).plugins);
}
