import type {
  DescribeModulesRequest,
  DescribingPorts,
  Repository,
  Responsibilities,
  RunEntry,
} from "../../src/index.js";
import { FakeClock } from "../fakes/fake-clock.js";
import { FakeConfirm } from "../fakes/fake-confirm.js";
import { FakeDescriber } from "../fakes/fake-describer.js";
import { FakeResponsibilitiesRepository } from "../fakes/fake-responsibilities-repository.js";
import { FakeRunLogRepository } from "../fakes/fake-run-log-repository.js";
import { PRICES } from "../fakes/prices.js";
import { repositoryOf } from "../fakes/repository-of.js";

export const ROOT = "/work/describing";

export class DescribingWorld {
  readonly describer = new FakeDescriber();
  readonly responsibilities = new FakeResponsibilitiesRepository();
  readonly confirm = new FakeConfirm(true);
  readonly clock = new FakeClock();
  readonly runLog = new FakeRunLogRepository();
  readonly said: string[] = [];
  readonly entries: RunEntry[] = [];
  readonly events: string[] = [];

  constructor() {
    this.describer.registered = true;
  }

  get ports(): DescribingPorts {
    return {
      describer: this.describer,
      confirm: this.confirm,
      clock: this.clock,
      responsibilities: this.responsibilities,
      runLog: this.runLog,
    };
  }

  repository(...ids: string[]): Repository {
    return repositoryOf(
      Object.fromEntries(ids.map((id) => [id, `scan-${id}`])),
      [],
    );
  }

  line(id: string, over: { sourceHash?: string; version?: string } = {}): void {
    const held = this.responsibilities.read(ROOT);

    held.set(id, {
      line: `line of ${id}`,
      sourceHash: over.sourceHash ?? `hash-${id}`,
      describer: this.describer.command,
      version: over.version ?? this.describer.version,
    });
    this.responsibilities.write(ROOT, held);
  }

  lines(): Responsibilities {
    return this.responsibilities.read(ROOT);
  }

  request(
    repository: Repository,
    over: Partial<DescribeModulesRequest> = {},
  ): DescribeModulesRequest {
    return {
      root: ROOT,
      repository,
      describer: {
        describerRef: true,
        command: this.describer.command,
        version: this.describer.version,
      },
      selection: { kind: "stale" },
      model: "opus",
      batchSize: 1,
      prices: PRICES,
      onEntry: (entry) => this.entries.push(entry),
      say: (_stream, text) => this.said.push(text),
      ...over,
    };
  }
}
