import { join } from "node:path";
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
  Say,
} from "@recognizer/core";
import { unregisteredMessage } from "@recognizer/core";
import { readDescribing } from "../../app-settings.js";
import type { Io } from "../../cli.js";
import { findDescriber } from "../../describer-in-effect.js";
import { InputError } from "../../errors.js";
import { readSource } from "../../module-source.js";
import { createPluginLimits, prepareCall } from "../../plugin-run.js";
import { entryFrom } from "../../run-log.js";
import { ResponsibilitiesAdapter } from "../filesystem/responsibilities-adapter.js";
import { documentKind, documentMember } from "../filesystem/scan-translator.js";
import {
  shippedDescriberInvocation,
  shippedDescriberName,
} from "./shipped-plugins-adapter.js";
import { sinkIo } from "./sink-io.js";

export class DescriberAdapter implements Describer {
  constructor(private readonly io: Io) {}

  locate(root: string): LocatedDescriber {
    const found = findDescriber(this.io, root);
    let describer: DescriberRef | null = null;
    let shipped = false;

    if (found !== null) {
      describer = {
        describerRef: true,
        command: found.command,
        version: found.version,
      };
      shipped = found.source === "shipped";
    }

    new ResponsibilitiesAdapter(this.io).read(root);

    return { describer, shipped };
  }

  refuseShipped(located: LocatedDescriber): void {
    if (located.shipped && located.describer !== null) {
      throw new InputError([unregisteredMessage(shippedDescriberName())]);
    }
  }

  probe(
    program: string,
    args: string[],
    cwd: string,
  ): { started: boolean; status: number | null } {
    const { started, status } = this.io.run(program, args, { cwd });

    return { started, status };
  }

  shippedName(): string {
    return shippedDescriberName();
  }

  shippedProgram(): string {
    return shippedDescriberInvocation()[0] as string;
  }

  settings(): { model: string; batchSize: number } {
    const { model, batch_size: batchSize } = readDescribing(this.io);

    return { model, batchSize };
  }

  readSource(
    root: string,
    path: string,
  ): { text: string; hash: string } | null {
    return readSource(this.io, root, path);
  }

  requestDocument(request: DescribeRequest): unknown {
    return {
      module: request.id,
      kind: documentKind(request.kind),
      files: request.files,
      source: request.source,
      members: request.members.map(documentMember),
      uses: request.uses,
      used_by: request.usedBy,
    };
  }

  open(root: string, say: Say): DescribeSession {
    return new Session(sinkIo(this.io, say), root);
  }
}

class Session implements DescribeSession {
  private temp: string | null = null;
  private readonly limits;

  constructor(
    private readonly io: Io,
    private readonly root: string,
  ) {
    this.limits = createPluginLimits(io, root);
  }

  readSource(path: string): { text: string; hash: string } | null {
    return readSource(this.io, this.root, path);
  }

  writeRequest(index: number, document: unknown): string {
    this.temp ??= this.io.makeTempDir();

    const file = join(this.temp, `request-${index}.json`);

    this.io.writeFile(file, `${JSON.stringify(document, null, 2)}\n`);

    return file;
  }

  start(
    command: readonly string[],
    onEvent: (name: string, event: Record<string, unknown>) => void,
  ): RunningCall {
    const [program, ...rest] = command as [string, ...string[]];
    const plugin = prepareCall(
      this.io,
      this.limits,
      command,
      "describer",
      onEvent,
    );
    const call = this.io.runAsync(program, rest, plugin.options);

    return {
      kill: () => call.kill(),
      result: call.result.then(
        (result): CallResult => ({
          started: result.started,
          status: result.status,
          stdout: result.stdout,
          stderr: plugin.reader.keep(result.stderr),
        }),
      ),
    };
  }

  entry(name: string, timing: EntryTiming): RunEntry {
    return entryFrom(name, timing) as RunEntry;
  }

  close(): void {
    if (this.temp !== null) {
      this.io.removeDir(this.temp);
      this.temp = null;
    }
  }
}
