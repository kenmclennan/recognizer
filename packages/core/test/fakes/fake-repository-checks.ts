import type {
  CachedScansState,
  ConfigDocumentRead,
  InstalledPlugin,
  PolicyFacts,
  PublishedKeyValues,
  RepositoryChecks,
} from "../../src/index.js";

export class FakeRepositoryChecks implements RepositoryChecks {
  readonly directories = new Set<string>();
  languageNames: string[] = [];
  configDocumentValue: ConfigDocumentRead = { kind: "absent" };
  schemaMessageList: string[] = [];
  keyList: PublishedKeyValues = [];
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

  publishedKeys(): PublishedKeyValues {
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

  registered: { name: string; command: string[]; manifest?: string[] }[] = [];
  suiteReads = 0;

  registeredSensors(): {
    name: string;
    command: string[];
    manifest?: string[];
  }[] {
    return this.registered.filter(
      (one) => one.name !== "structure" && one.command.length > 0,
    );
  }

  suites(): readonly unknown[] | undefined {
    this.suiteReads += 1;

    return this.suiteList;
  }
}
