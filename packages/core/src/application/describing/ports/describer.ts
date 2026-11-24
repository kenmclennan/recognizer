import type { DescribeRequest } from "../../../domain/describing/describe-request.js";
import type { RunEntry } from "../../../domain/run-record.js";
import type { PluginProgress } from "../../../domain/scan-event.js";
import type { Say } from "../../shared/ports/process.js";
import type { DescriberRef } from "./describer-ref.js";

export interface LocatedDescriber {
  describer: DescriberRef | null;
  shipped: boolean;
}

export interface EntryTiming {
  command: string[];
  status: number | null;
  stderr: string;
  duration_ms: number;
  reason?: string;
}

export interface CallResult {
  started: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface RunningCall {
  result: Promise<CallResult>;
  kill(): void;
}

export interface DescribeSession {
  readSource(path: string): { text: string; hash: string } | null;
  writeRequest(index: number, document: unknown): string;
  start(
    command: readonly string[],
    onEvent: (name: string, event: PluginProgress) => void,
  ): RunningCall;
  entry(name: string, timing: EntryTiming): RunEntry;
  close(): void;
}

export interface Describer {
  locate(root: string): LocatedDescriber;
  refuseShipped(located: LocatedDescriber): void;
  probe(
    program: string,
    args: string[],
    cwd: string,
  ): { started: boolean; status: number | null };
  shippedName(): string;
  shippedProgram(): string;
  folderInRepository(root: string, file: string): string | null;
  settings(): { model: string; batchSize: number };
  readSource(root: string, path: string): { text: string; hash: string } | null;
  requestDocument(request: DescribeRequest): unknown;
  open(root: string, say: Say): DescribeSession;
}
