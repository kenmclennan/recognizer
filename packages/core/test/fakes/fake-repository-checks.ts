import type {
  ConfigReading,
  Found,
  InstalledPlugin,
  RepositoryChecks,
} from "../../src/index.js";

export class FakeRepositoryChecks implements RepositoryChecks {
  readonly directories = new Set<string>();
  languageNames: string[] = [];
  configReading: ConfigReading = {
    problems: [],
    registered: {
      specs: [],
      named: {},
      install: {},
      sensors: [],
      describer: false,
    },
  };
  policyProblems: Found[] = [];
  suiteList: readonly unknown[] | undefined;
  shippedDescriber = false;

  isDirectory(root: string): boolean {
    return this.directories.has(root);
  }

  languages(_root: string, _scanners: readonly InstalledPlugin[]): string[] {
    return this.languageNames;
  }

  config(): ConfigReading {
    return this.configReading;
  }

  policy(): Found[] {
    return this.policyProblems;
  }

  suites(): readonly unknown[] | undefined {
    return this.suiteList;
  }

  describerShipped(): boolean {
    return this.shippedDescriber;
  }
}
