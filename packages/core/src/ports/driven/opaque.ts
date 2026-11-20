export interface ScanDocument {
  readonly files: readonly unknown[];
}

export interface PluginLimits {
  readonly pluginLimits: true;
}

export interface ConfigDocument {
  readonly configDocument: true;
}

export interface PolicyDocument {
  readonly policyDocument: true;
}

export interface ParserSet {
  readonly parserSet: true;
}

export type Say = (stream: "stdout" | "stderr", text: string) => void;
