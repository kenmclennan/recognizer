import type {
  CallResult,
  DescribeRequest,
  Describer,
  DescriberRef,
  DescribeSession,
  EntryTiming,
  LocatedDescriber,
  RunEntry,
  RunningCall,
} from "../../src/index.js";
import { describingValues, type Prices } from "../../src/index.js";

export class FakeDescriber implements Describer {
  registered = false;
  described: string[] = [];
  command: readonly string[] = ["quill", "run", "{module}"];
  version = "v1";
  published: string | null = "quill";
  stored: Record<string, unknown> = { batch_size: 2 };
  prices: Prices | undefined = undefined;
  unavailable = new Set<string>();
  results = new Map<
    string,
    { status: number; stdout: string; stderr?: string; started?: boolean }
  >();
  unreadable = new Set<string>();
  held = new Set<string>();
  killed: string[] = [];
  opened = 0;
  closed = 0;
  started: string[][] = [];

  locate(): LocatedDescriber {
    return {
      describer: this.registered
        ? ({
            describerRef: true,
            command: this.command,
            version: this.version,
          } satisfies DescriberRef)
        : null,
    };
  }

  probe(program: string): { started: boolean; status: number | null } {
    return this.unavailable.has(program)
      ? { started: false, status: null }
      : { started: true, status: 0 };
  }

  settings(): { model: string; batchSize: number; prices: Prices | undefined } {
    const values = describingValues(this.stored, { model: this.published });

    return {
      model: values.model as string,
      batchSize: values.batch_size,
      prices: this.prices,
    };
  }

  readSource(
    _root: string,
    path: string,
  ): { text: string; hash: string } | null {
    return this.unreadable.has(path)
      ? null
      : { text: `source of ${path}`, hash: `hash-${path}` };
  }

  requestDocument(request: DescribeRequest): unknown {
    return request;
  }

  open(): DescribeSession {
    this.opened += 1;

    return {
      readSource: (path) => this.readSource("", path),
      writeRequest: (index) => `/tmp/request-${index}.json`,
      start: (command) => this.call(command),
      entry: (name: string, timing: EntryTiming): RunEntry => ({
        name,
        command: timing.command,
        status: timing.status,
        outcome: timing.reason === undefined ? "ok" : "failed",
        duration_ms: timing.duration_ms,
        stderr: timing.stderr,
        ...(timing.reason === undefined ? {} : { reason: timing.reason }),
      }),
      close: () => {
        this.closed += 1;
      },
    };
  }

  private call(command: readonly string[]): RunningCall {
    const module = command[command.length - 1] as string;

    this.started.push([...command]);

    let settle: (result: CallResult) => void = () => {};
    const result = new Promise<CallResult>((resolve) => {
      settle = resolve;
    });

    if (this.held.has(module)) {
      return {
        result,
        kill: () => {
          this.killed.push(module);
          settle({ started: true, status: null, stdout: "", stderr: "" });
        },
      };
    }

    const seeded = this.results.get(module) ?? {
      status: 0,
      stdout: `line for ${module}`,
    };

    this.described.push(module);
    settle({
      started: seeded.started ?? true,
      status: seeded.status,
      stdout: seeded.stdout,
      stderr: seeded.stderr ?? "",
    });

    return { result, kill: () => {} };
  }
}
