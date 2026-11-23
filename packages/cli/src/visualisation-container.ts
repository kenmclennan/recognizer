import { resolve } from "node:path";
import { visualisationFresh, visualisationOver } from "@recognizer/core";
import { ViewAdapter } from "./adapters/filesystem/view-adapter.js";
import { ChangesAdapter } from "./adapters/git/changes-adapter.js";
import { WindowsAdapter } from "./adapters/system/windows-adapter.js";
import type { Io } from "./cli.js";
import { asInputError, asRefusal } from "./errors.js";
import { freshPorts } from "./fresh-ports.js";
import { requestFrom } from "./scan-main.js";

type Visualisation = ReturnType<typeof visualisationOver>;

function guarded<A, R>(run: (request: A) => R): (request: A) => R {
  return (request) => asRefusal(() => asInputError(() => run(request)));
}

export function visualisationFor(io: Io, _root: string): Visualisation {
  const core = visualisationOver(
    visualisationFresh(
      {
        ...freshPorts(io, []),
        views: new ViewAdapter(io),
        changes: new ChangesAdapter(io),
        windows: new WindowsAdapter(io),
      },
      (root) => ({
        scan: requestFrom([resolve(root), "--extract"], io).request,
      }),
    ),
  );

  return Object.fromEntries(
    Object.entries(core).map(([name, run]) => [
      name,
      guarded(run as (request: unknown) => unknown),
    ]),
  ) as unknown as Visualisation;
}
