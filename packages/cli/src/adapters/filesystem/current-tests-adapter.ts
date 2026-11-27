import { join } from "node:path";
import {
  type BaselineText,
  type CurrentTests,
  discoverPlugins,
  testsHashOf,
} from "@recognizer/core";
import type { Io } from "../../cli.js";
import { manifestPorts } from "../../manifest-ports.js";
import { PublishedLanguagesAdapter } from "../plugins/published-languages-adapter.js";
import { TestReportsAdapter } from "../plugins/test-reports-adapter.js";
import { DigestAdapter } from "../system/digest-adapter.js";
import { RepositoryFilesAdapter } from "./repository-files-adapter.js";
import { readRepositoryText } from "./repository-text.js";
import { SourceFilesAdapter } from "./source-files-adapter.js";

export function currentTestsDigest(
  ports: Parameters<typeof testsHashOf>[0],
  root: string,
): string | null {
  const published = ports.languages
    .rules()
    .some((rule) => (rule.test_files ?? []).length > 0);

  return published ? testsHashOf(ports, root, new Map()) : null;
}

export class CurrentTestsAdapter implements CurrentTests {
  constructor(private readonly io: Io) {}

  digest(root: string): string | null {
    return currentTestsDigest(
      {
        source: new SourceFilesAdapter(this.io),
        repositoryFiles: new RepositoryFilesAdapter(this.io),
        digest: new DigestAdapter(),
        testReports: new TestReportsAdapter(this.io),
        languages: new PublishedLanguagesAdapter(() => {
          const found = discoverPlugins(manifestPorts(this.io), ["scanner"]);

          if (found.unreadable.length > 0) {
            throw new Error(
              `a scanner manifest could not be read: ${found.unreadable[0]?.reason}`,
            );
          }

          return found.plugins;
        }),
      },
      root,
    );
  }
}

export class BaselineTextAdapter implements BaselineText {
  constructor(private readonly io: Io) {}

  hash(root: string): string {
    return readRepositoryText(
      this.io,
      join(root, ".recognizer", "baselines", "violations.json"),
    ).hash;
  }
}
