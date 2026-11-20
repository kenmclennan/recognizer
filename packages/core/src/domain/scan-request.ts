export type ScanMode = "incremental" | "full";

export type DescribeIntent = false | "stale" | "all";

export interface SensorRequest {
  name: string;
  suites?: string[];
}

export interface ScopeFile {
  file: string;
  names: string[];
}

export interface ScanRequest {
  repository: string;
  mode: ScanMode;
  sensors: null | "all" | SensorRequest[];
  describe: DescribeIntent;
  analysis: boolean;
  confirmAbove?: number;
  modules?: ScopeFile;
  by?: string;
  ignoreRetiredConfig: boolean;
  suitesFile?: string;
  invocation: string[];
}

export class InvalidRequest extends Error {
  readonly messages: string[];

  constructor(messages: string[]) {
    super(messages.join("\n"));
    this.name = "InvalidRequest";
    this.messages = messages;
  }
}
