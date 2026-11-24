import {
  type HistoricalPorts,
  type HistoricalScan,
  type HistoricalScanOutcome,
  type HistoricalScanRequest,
  Limiter,
  MemoisedComparisons,
} from "../../src/index.js";
import { FakeClock } from "../fakes/fake-clock.js";
import { FakeGit } from "../fakes/fake-git.js";
import { FakeScanCache } from "../fakes/fake-scan-cache.js";
import { FakeScratch } from "../fakes/fake-scratch.js";

export class ScriptedScan implements HistoricalScan {
  readonly requests: HistoricalScanRequest[] = [];
  outcome: HistoricalScanOutcome = { status: "finished" };
  stderr: string[] = [];
  throws = false;
  active = 0;
  peak = 0;
  delay = 0;

  start(request: HistoricalScanRequest) {
    this.requests.push(request);

    if (this.throws) {
      throw new Error("the scan could not start");
    }

    this.active += 1;
    this.peak = Math.max(this.peak, this.active);

    const stderr = this.stderr;
    const events = (async function* () {
      for (const text of stderr) {
        yield {
          type: "notice" as const,
          stream: "stderr" as const,
          text,
          humanOnly: false,
        };
      }
    })();
    const outcome = new Promise<HistoricalScanOutcome>((resolve) =>
      setTimeout(() => {
        this.active -= 1;
        resolve(this.outcome);
      }, this.delay),
    );

    return { events, outcome };
  }
}

export class HistoryWorld {
  readonly git = new FakeGit("c0ffee");
  readonly scratch = new FakeScratch();
  readonly scan = new ScriptedScan();
  readonly cache = new FakeScanCache();
  readonly clock = new FakeClock();
  private readonly limiter = new Limiter(3);

  constructor() {
    this.cache.fallback = [{ file: "scan.typescript.json", text: "{}" }];
  }

  get ports(): HistoricalPorts {
    return {
      git: this.git,
      scratch: this.scratch,
      scan: this.scan,
      cache: this.cache,
      clock: this.clock,
      comparisons: this.comparisons,
      limiter: this.limiter,
    };
  }

  private readonly comparisons = new MemoisedComparisons(this.clock);
}
