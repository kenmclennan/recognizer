export interface Registration {
  kind: "sensor" | "describer";
  name: string;
  program: string;
  shipped: boolean;
  manifest: {
    install: string;
    prompt_version?: string;
  };
}

export interface Registered {
  sensors: Record<string, unknown>;
  describerProgram: string | undefined;
}

export type RegisterOutcome =
  | { status: "registered" | "already-registered" }
  | { status: "refused"; reason: string };

export interface PluginRegistry {
  registered(root: string): Registered;
  register(root: string, registration: Registration): RegisterOutcome;
}
