import type {
  AcquiredLock,
  HeldLock,
  LockDetails,
  ScanLock,
  ScanStatus,
} from "@recognizer/core";
import type { Io } from "../../cli.js";
import { errorText } from "../../errors.js";
import { awaitDescribeAnswer } from "../../scan-answer.js";
import {
  acquireMarker,
  markerPath,
  readLiveMarker,
  refusalText,
} from "../../scan-marker.js";
import { fileLine } from "../../scan-wire.js";

export class ScanLockAdapter implements ScanLock {
  constructor(private readonly io: Io) {}

  acquire(root: string, details: LockDetails): AcquiredLock {
    const acquired = acquireMarker(this.io, root, details);

    if (!acquired.ok) {
      return { ok: false, text: refusalText(acquired.marker, acquired.path) };
    }

    const { held } = acquired;
    const lock: HeldLock = {
      startedAt: Date.parse(held.startedAt),
      append: (event) => {
        const line = fileLine(event);

        if (line !== null) {
          held.append(line);
        }
      },
      running: () => held.running(),
      refused: (gaps, summary) => held.refused(gaps, summary),
      end: (exit, failure, summary) =>
        held.end(exit, failure as never, summary),
      crashed: (error) => held.crashed(errorText(error)),
      release: () => held.release(),
      awaitAnswer: async () => {
        const describe = await awaitDescribeAnswer(this.io, root, held);

        return describe;
      },
    };

    return { ok: true, lock };
  }

  status(root: string): ScanStatus {
    const marker = readLiveMarker(this.io, root);

    return marker === null
      ? { running: false }
      : {
          running: true,
          refusal: refusalText(marker, markerPath(root)),
          phase: marker.phase,
          sensors: marker.sensors,
          describe: marker.describe,
          startedBy: marker.started_by,
        };
  }
}
