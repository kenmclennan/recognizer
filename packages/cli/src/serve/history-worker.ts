import { parentPort } from "node:worker_threads";
import { nodeIo } from "../cli.js";
import { errorText } from "../errors.js";
import { processScope } from "../stop-scope.js";
import { HistoryOps } from "./history-ops.js";
import { quiet } from "./quiet.js";

const ops = new HistoryOps(quiet(nodeIo(processScope)));

parentPort?.on(
  "message",
  (request: { id: number; op: string; args: Record<string, unknown> }) => {
    void ops
      .run(request.op, request.args)
      .then((ok) => parentPort?.postMessage({ id: request.id, ok }))
      .catch((error: unknown) =>
        parentPort?.postMessage({ id: request.id, error: errorText(error) }),
      );
  },
);
