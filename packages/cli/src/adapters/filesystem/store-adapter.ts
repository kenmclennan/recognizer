import type {
  AcquiredLock,
  ConfigDocument,
  RunPhase as CoreRunPhase,
  HeldLock,
  LockDetails,
  PolicyDocument,
  RunLog,
  ScanStatus,
  Store,
} from "@recognizer/core";
import type { Io } from "../../cli.js";
import { readConfig } from "../../config.js";
import {
  type ConfigRead,
  readsAnyConfig,
  readsSensors,
} from "../../config-parse.js";
import { errorText } from "../../errors.js";
import { findingsFile } from "../../findings-files.js";
import { readPolicy } from "../../load-findings.js";
import { openPhasedRunLog } from "../../run-log.js";
import { awaitDescribeAnswer } from "../../scan-answer.js";
import { cacheFile } from "../../scan-facts.js";
import {
  acquireMarker,
  readLiveMarker,
  refusalText,
} from "../../scan-marker.js";
import { fileLine } from "../../scan-wire.js";
import { structureOverlayFile } from "../../structure-overlay.js";

export class StoreAdapter implements Store {
  constructor(
    private readonly io: Io,
    private readonly read: ConfigRead,
  ) {}

  isDirectory(root: string): boolean {
    try {
      this.io.readDir(root);

      return true;
    } catch {
      return false;
    }
  }

  scannerSetup(root: string): {
    scanners: Record<string, string>;
    install: Record<string, string>;
  } {
    const registered = readConfig(this.io, root, ["scanners", "install"]);

    return {
      scanners: registered?.scanners ?? {},
      install: registered?.install ?? {},
    };
  }

  runConfig(root: string, skipRetired: boolean): ConfigDocument | null {
    return (readsAnyConfig(this.read)
      ? readConfig(this.io, root, this.read, { skipRetired })
      : null) as unknown as ConfigDocument | null;
  }

  analysisConfig(root: string, skipRetired: boolean): ConfigDocument | null {
    return readConfig(this.io, root, ["sensors"], {
      skipRetired,
    }) as unknown as ConfigDocument | null;
  }

  readsSensorConfig(): boolean {
    return readsSensors(this.read);
  }

  policy(root: string): PolicyDocument {
    return readPolicy(this.io, root) as unknown as PolicyDocument;
  }

  writeScan(root: string, language: string, bytes: string): void {
    this.io.writeFile(cacheFile(root, language), bytes);
  }

  remove(path: string): boolean {
    if (!this.io.exists(path)) {
      return false;
    }

    this.io.remove(path);

    return true;
  }

  removeAnalysisOutputs(root: string, off: boolean): void {
    this.io.remove(findingsFile(root, "duplication"));

    if (off) {
      this.io.remove(findingsFile(root, "structure"));
      this.io.remove(structureOverlayFile(root));
    }
  }

  openRunLog(
    root: string,
    startedAt: number,
    by: string | undefined,
    invocation: string[],
  ): RunLog {
    const log = openPhasedRunLog(this.io, root, startedAt, by, invocation);
    const recorded = (phases: CoreRunPhase[]) =>
      phases.map((phase) =>
        phase.phase === "analysis" ? { ...phase, phase: "structure" } : phase,
      ) as unknown as Parameters<typeof log.update>[0];

    return {
      skip: (phase) => log.skip(phase),
      update: (phases) => log.update(recorded(phases)),
      finish: (phases, failed, analysisMs) =>
        log.finish(recorded(phases), failed, analysisMs),
      id: () => log.id() as string,
    };
  }

  acquireLock(root: string, details: LockDetails): AcquiredLock {
    const acquired = acquireMarker(this.io, root, details);

    if (!acquired.ok) {
      return { ok: false, text: refusalText(acquired.marker, acquired.path) };
    }

    const { held } = acquired;
    const lock: HeldLock = {
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
          phase: marker.phase,
          sensors: marker.sensors,
          describe: marker.describe,
          startedBy: marker.started_by,
        };
  }
}
