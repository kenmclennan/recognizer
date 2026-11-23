import { dirname, isAbsolute, relative } from "node:path";
import type {
  DescribeCall,
  DescribeResult,
  Describer,
  DescriberRef,
  LocatedDescriber,
  Projection,
} from "@recognizer/core";
import { unregisteredMessage } from "@recognizer/core";
import { readDescribing } from "../../app-settings.js";
import type { Io } from "../../cli.js";
import {
  type Describer as CliDescriber,
  describeModules,
  readResponsibilities,
} from "../../describe-modules.js";
import { findDescriber } from "../../describer-in-effect.js";
import { InputError } from "../../errors.js";
import { shippedDescriberName } from "./shipped-plugins-adapter.js";
import { sinkIo } from "./sink-io.js";

export class DescriberAdapter implements Describer {
  constructor(private readonly io: Io) {}

  locate(root: string): LocatedDescriber {
    const found = findDescriber(this.io, root);
    let describer: DescriberRef | null = null;
    let shipped = false;

    if (found !== null) {
      const { source, ...rest } = found;

      describer = rest as unknown as DescriberRef;
      shipped = source === "shipped";
    }

    readResponsibilities(this.io, root);

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

  folderInRepository(root: string, file: string): string | null {
    const folder = relative(root, dirname(dirname(file)));

    return folder.startsWith("..") || isAbsolute(folder) ? null : folder;
  }

  settings(): { model: string; batchSize: number } {
    const { model, batch_size: batchSize } = readDescribing(this.io);

    return { model, batchSize };
  }

  async describe(call: DescribeCall): Promise<DescribeResult> {
    const confirm = call.confirm;

    return (await describeModules({
      io: sinkIo(this.io, call.say),
      root: call.root,
      repository: call.repository,
      describer: call.describer as unknown as CliDescriber,
      model: call.model,
      batchSize: call.batchSize,
      selection: call.selection,
      ...(confirm === undefined
        ? {}
        : {
            confirm: (projection) =>
              confirm(projection as unknown as Projection),
          }),
      onProjection: (projection) =>
        call.onProjection(projection as unknown as Projection),
      onStart: call.onStart,
      onEvent: (name, event) =>
        call.onEvent(name, event as unknown as Record<string, unknown>),
      onEntry: (entry) => call.onEntry(entry as never),
    })) as unknown as DescribeResult;
  }
}
