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

  registered: { name: string; command: string[] }[] = [];
  suiteReads = 0;

  registeredSensors(): { name: string; command: string[] }[] {
    return this.registered.filter(
      (one) => one.name !== "structure" && one.command.length > 0,
    );
  }

  suites(): readonly unknown[] | undefined {
    this.suiteReads += 1;

    return this.suiteList;
  }
}
