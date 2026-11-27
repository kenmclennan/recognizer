import {
  loadFindings as loadFindingsFrom,
  type Repository,
  type SensorFindings,
} from "@recognizer/core";
import { ConfigAdapter } from "./adapters/filesystem/config-adapter.js";
import { FindingsAdapter } from "./adapters/filesystem/findings-adapter.js";
import { PolicyAdapter } from "./adapters/filesystem/policy-adapter.js";
import { SourceFilesAdapter } from "./adapters/filesystem/source-files-adapter.js";
import { TestReportsAdapter } from "./adapters/plugins/test-reports-adapter.js";
import { DigestAdapter } from "./adapters/system/digest-adapter.js";
import type { Io } from "./cli.js";
import { installedLanguages } from "./published-languages.js";

export function loadFindings(
  io: Io,
  root: string,
  repository: Repository,
): SensorFindings[] {
  return loadFindingsFrom(
    {
      config: new ConfigAdapter(io, ["sensors"]),
      findings: new FindingsAdapter(io),
      policy: new PolicyAdapter(io),
      source: new SourceFilesAdapter(io),
      digest: new DigestAdapter(),
      testReports: new TestReportsAdapter(io),
      languages: installedLanguages(io),
    },
    (stream, text) => (stream === "stdout" ? io.stdout(text) : io.stderr(text)),
    root,
    repository,
  );
}
