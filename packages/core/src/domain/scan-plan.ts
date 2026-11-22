export type SuiteRef = { name: string; language: string };

export type SuiteTickEntry = { ticked: string[]; known: string[] };

export type ScanTicks = {
  describe: boolean;
  analysis: boolean;
  ticked: string[] | null;
  once: string[];
  onlyView: boolean;
  suites: Record<string, SuiteTickEntry>;
  folds: string[];
};

export type ScanIntent = {
  describe: boolean;
  describeAll: boolean;
  analysis: boolean;
  sense: string[];
  modules: string[] | null;
  suites?: Record<string, string[]>;
};

export type SensorRow = {
  name: string;
  display: string;
  runsTests: boolean;
  scoped: boolean;
  registered: boolean;
  suites?: SuiteRef[];
};

export type LineKind = "current" | "out-of-date" | "missing" | "unknown";

export type ResponsibilityKinds = {
  registered: boolean;
  kinds: Record<string, LineKind>;
};

export type Measured = { inputs?: Record<string, string>; tests?: string };

export type ScanFacts = {
  modules: readonly {
    id: string;
    members?: readonly {
      kind?: string;
      methods?: readonly unknown[];
    }[];
  }[];
  files?: readonly { path: string; hash: string }[];
};
