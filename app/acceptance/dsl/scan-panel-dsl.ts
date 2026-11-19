import {
  frontEndDriver,
  type PanelDriver,
  type Repository,
} from "../driver/front-end-driver";

type Plan = Awaited<ReturnType<PanelDriver["startScan"]>>;

const NAMES: Record<string, string> = {
  Mutation: "mutation",
  "C.R.A.P.": "crap",
};

const SHIPPED_ORDER = ["mutation", "crap"];

export function namesIn(cell: string, what = "a list"): string[] {
  const text = cell.trim();

  if (text === "") {
    throw new Error(`The cell for ${what} is empty: write "nothing" for none`);
  }

  return text === "nothing" ? [] : text.split(" and ").map((one) => one.trim());
}

function internalNames(shown: string[]): string[] {
  return shown.map((name) => {
    const internal = NAMES[name];

    if (internal === undefined) {
      throw new Error(`Unknown sensor ${name}`);
    }

    return internal;
  });
}

export type World = {
  repository: RepositoryBuilder;
  panel: PanelVocabulary;
  scan: ScanVocabulary;
};

class RepositoryBuilder {
  private suites: string[] = [];
  private described: string[] = [];
  private undescribed: string[] = [];

  withSuites(...names: string[]): this {
    this.suites = names;

    return this;
  }

  withDescribedFiles(...names: string[]): this {
    this.described = names;

    return this;
  }

  withUndescribedFiles(...names: string[]): this {
    this.undescribed = names;

    return this;
  }

  build(): Repository {
    return {
      suites: this.suites,
      describedFiles: this.described,
      undescribedFiles: this.undescribed,
    };
  }
}

class PanelVocabulary {
  private driver: PanelDriver | null = null;

  constructor(private readonly repository: RepositoryBuilder) {}

  private get open(): PanelDriver {
    this.driver ??= frontEndDriver(this.repository.build());

    return this.driver;
  }

  tick(sensor: string) {
    this.open.tick(sensor);
  }

  untick(sensor: string) {
    this.open.untick(sensor);
  }

  tickAll(cell: string) {
    for (const sensor of namesIn(cell, "the ticked sensors")) {
      this.open.tick(sensor);
    }
  }

  untickAll(cell: string) {
    for (const sensor of namesIn(cell, "the unticked sensors")) {
      this.open.untick(sensor);
    }
  }

  tickSuite(sensor: string, suite: string) {
    this.open.tickSuite(sensor, suite);
  }

  tickDescriptions() {
    this.open.tickDescriptions(true);
  }

  chooseMode(mode: string) {
    if (mode !== "Incremental" && mode !== "Full") {
      throw new Error(`Unknown mode ${mode}`);
    }

    this.open.chooseMode(mode);
  }

  showPlan() {
    this.open.showPlan();
  }

  startScan(): Promise<Plan> {
    return this.open.startScan();
  }
}

class ScanVocabulary {
  private plan: Plan | null = null;

  constructor(private readonly repository: RepositoryBuilder) {}

  record(plan: Plan) {
    this.plan = plan;
  }

  private get started(): Plan {
    if (this.plan === null) {
      throw new Error("No scan has started");
    }

    return this.plan;
  }

  expectSenses(cell: string) {
    const expected = new Set(
      internalNames(namesIn(cell, "what the scan senses")),
    );
    const actual = new Set(this.started.sense);
    const order = (names: Set<string>) =>
      SHIPPED_ORDER.filter((name) => names.has(name));

    expectEqual(order(actual), order(expected), "senses");
  }

  expectDescribes(cell: string) {
    const plan = this.started;
    const value = cell.trim();

    if (value === "") {
      throw new Error(
        `The cell for what the scan describes is empty: write "nothing", "all files" or "changed files only"`,
      );
    }

    if (value === "nothing") {
      expectEqual(plan.describe, false, "describes");
    } else if (value === "all files") {
      expectEqual([plan.describe, plan.describeAll], [true, true], "describes");
    } else if (value === "changed files only") {
      expectEqual(
        [plan.describe, plan.describeAll, plan.modules],
        [true, false, this.repository.build().undescribedFiles],
        "describes",
      );
    } else {
      throw new Error(`Unknown describes value ${value}`);
    }
  }

  expectSuites(sensor: string, cell: string) {
    const [internal] = internalNames([sensor]);

    expectEqual(
      this.started.suites?.[internal as string] ?? [],
      namesIn(cell, `the suites ${sensor} runs`),
      `suites of ${sensor}`,
    );
  }
}

function expectEqual(actual: unknown, expected: unknown, what: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);

  if (a !== e) {
    throw new Error(`Expected ${what} ${e} but got ${a}`);
  }
}

export function newWorld(): World & { startScan(): Promise<void> } {
  const repository = new RepositoryBuilder()
    .withSuites("unit", "web")
    .withDescribedFiles("a.py", "b.py")
    .withUndescribedFiles("c.py");
  const panel = new PanelVocabulary(repository);
  const scan = new ScanVocabulary(repository);

  return {
    repository,
    panel,
    scan,
    async startScan() {
      scan.record(await panel.startScan());
    },
  };
}
