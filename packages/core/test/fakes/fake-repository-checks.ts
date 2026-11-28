import type {
  CachedScansState,
  ConfigDocumentRead,
  InstalledPlugin,
  PolicyFacts,
  PublishedValues,
  RepositoryChecks,
} from "../../src/index.js";

export class FakeRepositoryChecks implements RepositoryChecks {
  readonly directories = new Set<string>();
  languageNames: string[] = [];
  configDocumentValue: ConfigDocumentRead = { kind: "absent" };
  schemaMessageList: string[] = [];
  keyList: PublishedValues = [];
  policyFactsValue: PolicyFacts = { kind: "absent" };
  scansStateValue: CachedScansState = { state: "missing" };
  scansReads = 0;
  keyReads = 0;
  suiteList: readonly unknown[] | undefined;

  isDirectory(root: string): boolean {
    return this.directories.has(root);
  }

  languages(_root: string, _scanners: readonly InstalledPlugin[]): string[] {
    return this.languageNames;
  }

  configDocument(): ConfigDocumentRead {
    return this.configDocumentValue;
  }

  configSchemaMessages(): string[] {
    return this.schemaMessageList;
  }

  publishedKeys(): PublishedValues {
    this.keyReads += 1;

    return this.keyList;
  }

  policyFacts(): PolicyFacts {
    return this.policyFactsValue;
  }

  scansState(): CachedScansState {
    this.scansReads += 1;

    return this.scansStateValue;
  }

  suiteReads = 0;
  settingsByName: Record<string, Record<string, unknown>> = {};

  sensorSettings(_root: string, name: string): Record<string, unknown> {
    return this.settingsByName[name] ?? {};
  }

  suites(): readonly unknown[] | undefined {
    this.suiteReads += 1;

    return this.suiteList;
  }
}
