import { describingOver } from "@recognizer/core";
import { ResponsibilitiesAdapter } from "./adapters/filesystem/responsibilities-adapter.js";
import { RunLogAdapter } from "./adapters/filesystem/run-log-adapter.js";
import { DescriberAdapter } from "./adapters/plugins/describer-adapter.js";
import { ClockAdapter } from "./adapters/system/clock-adapter.js";
import { ConfirmAdapter } from "./adapters/terminal/confirm-adapter.js";
import type { Io } from "./cli.js";
import { asInputError } from "./errors.js";

type Describing = ReturnType<typeof describingOver>;

export function describingFor(io: Io): Describing {
  const core = describingOver({
    describer: new DescriberAdapter(io),
    confirm: new ConfirmAdapter(io),
    clock: new ClockAdapter(io),
    responsibilities: new ResponsibilitiesAdapter(io),
    runLog: new RunLogAdapter(io),
  });

  return {
    readDescriber: (root) => asInputError(() => core.readDescriber(root)),
    readResponsibility: (request) =>
      asInputError(() => core.readResponsibility(request)),
    checkDescriptions: (request) =>
      asInputError(() => core.checkDescriptions(request)),
    describeRecorded: async (request) => {
      try {
        return await core.describeRecorded(request);
      } catch (error) {
        return asInputError(() => {
          throw error;
        });
      }
    },
    describeModules: async (request) => {
      try {
        return await core.describeModules(request);
      } catch (error) {
        return asInputError(() => {
          throw error;
        });
      }
    },
  };
}
