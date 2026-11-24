export interface AssistantAllow {
  tools: string[];
  commands: { command: string; anyArguments: boolean }[];
}

export interface AssistantAnswer {
  structured: unknown | null;
  costUsd: number | null;
  durationMs: number | null;
  isError: boolean;
  subtype: string | null;
  text: string | null;
  denials: number;
}

export interface AssistantResult {
  answer: AssistantAnswer | null;
  exit: number | null;
  stderr: string;
  started: boolean;
}

export interface AssistantRequest {
  root: string;
  model: string;
  prompt: string;
  schema: string;
  allow: AssistantAllow;
  environment?: Readonly<Record<string, string>>;
  onLine: (line: string) => void;
}

export interface RunningAsk {
  result: Promise<AssistantResult>;
  kill(): void;
}

export interface Assistant {
  ask(request: AssistantRequest): RunningAsk;
}
