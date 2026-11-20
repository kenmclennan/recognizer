export interface PluginLimits {
  readonly pluginLimits: true;
}

export type Say = (stream: "stdout" | "stderr", text: string) => void;

export interface ProcessControl {
  limits(root: string): PluginLimits;
  stopAll(): Promise<void>;
}
