import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import type { SensorRequest } from "../../src/index.js";
import { cachePath } from "../fakes/fake-store.js";
import { REPOSITORY, type ScanWorld } from "../fakes/world.js";

const language = (word: string): string => word.toLowerCase();

Given("a repository with Alpha files", function (this: ScanWorld) {
  this.addLanguage("alpha");
});

Given(
  "a repository with Alpha files and Beta files",
  function (this: ScanWorld) {
    this.addLanguage("alpha");
    this.addLanguage("beta");
  },
);

Given(
  "its Alpha scan is current at the repository's commit",
  function (this: ScanWorld) {
    this.cacheLanguage("alpha", "c0ffee");
  },
);

Given("an old Alpha scan is in the cache", function (this: ScanWorld) {
  this.cacheLanguage("alpha", "old");
});

Given("an old Gamma scan is in the cache", function (this: ScanWorld) {
  this.cacheLanguage("gamma", "old");
});

Given("the Alpha scanner fails", function (this: ScanWorld) {
  this.failLanguage("alpha");
});

Given(
  "a Tally sensor and a Margin sensor are registered",
  function (this: ScanWorld) {
    this.addSensor("tally", false);
    this.addSensor("margin", false);
  },
);

Given("a Tally sensor is registered", function (this: ScanWorld) {
  this.addSensor("tally", false);
});

Given(
  "a Tally sensor is registered and held while it runs",
  function (this: ScanWorld) {
    this.addSensor("tally", false, true);
  },
);

Given(
  "a Tally sensor that runs tests and a Margin sensor that does not are registered",
  function (this: ScanWorld) {
    this.addSensor("tally", true);
    this.addSensor("margin", false);
  },
);

Given(
  "the suites {string} and {string} are configured",
  function (this: ScanWorld, first: string, second: string) {
    this.fakes.sensors.suites.push(first, second);
  },
);

Given(
  "the Tally sensor needs {string} and {string}",
  function (this: ScanWorld, first: string, second: string) {
    this.requireOfSensor("tally", first);
    this.requireOfSensor("tally", second);
  },
);

Given("a Quill describer is registered", function (this: ScanWorld) {
  this.fakes.describer.registered = true;
});

Given(
  "describing would cost {int} dollars",
  function (this: ScanWorld, cost: number) {
    this.fakes.describer.projected = { modules: 2, cost_usd: cost };
  },
);

Given("the person declines to confirm", function (this: ScanWorld) {
  this.fakes.confirm.answer = false;
});

Given(
  "a scan ticking the Tally sensor is running",
  async function (this: ScanWorld) {
    const scan = this.begin({ mode: "full", sensors: [{ name: "tally" }] });

    void this.collect(scan);

    await this.fakes.sensors.started;
  },
);

When("an incremental scan runs", async function (this: ScanWorld) {
  await this.run({ mode: "incremental" });
});

When("a full scan runs", async function (this: ScanWorld) {
  await this.run({ mode: "full" });
});

When(
  "a full scan runs ticking the Tally sensor",
  async function (this: ScanWorld) {
    await this.run({ mode: "full", sensors: [{ name: "tally" }] });
  },
);

When(
  "a full scan runs ticking both sensors with the suite {string} for the Tally sensor",
  async function (this: ScanWorld, suite: string) {
    const sensors: SensorRequest[] = [
      { name: "tally", suites: [suite] },
      { name: "margin" },
    ];

    await this.run({ mode: "full", sensors });
  },
);

When(
  "a full scan runs describing everything with confirmation above {int} dollars",
  async function (this: ScanWorld, limit: number) {
    this.confirmAbove = limit;

    await this.run({ mode: "full", describe: "all" });
  },
);

When("a second scan starts", async function (this: ScanWorld) {
  await this.readStatus();
  await this.beginSecond({ mode: "full", sensors: [{ name: "tally" }] });
});

When("the scan is stopped", async function (this: ScanWorld) {
  const scan = this.running;

  assert.ok(scan);

  await scan.stop();

  this.outcome = await scan.outcome;
});

Then("nothing is extracted", function (this: ScanWorld) {
  assert.deepEqual(this.fakes.scanners.extracted, []);
});

Then("the scan finishes", function (this: ScanWorld) {
  assert.deepEqual(this.outcome, { status: "finished" });
});

Then("the scan fails", function (this: ScanWorld) {
  assert.deepEqual(this.outcome, { status: "failed", reason: "phases" });
});

Then("Alpha and Beta are extracted", function (this: ScanWorld) {
  assert.deepEqual(this.fakes.scanners.extracted, ["alpha", "beta"]);
});

Then(
  /^the (Alpha|Beta) scan is written to the cache$/,
  function (this: ScanWorld, word: string) {
    assert.ok(
      this.fakes.store.files.has(cachePath(REPOSITORY, language(word))),
    );
  },
);

Then("the Alpha entry is reported as failed", function (this: ScanWorld) {
  const entry = this.eventsOf("entry").find(
    (one) => one.entry.name === "alpha",
  );

  assert.equal(entry?.entry.outcome, "failed");
});

Then("the old Alpha scan is removed", function (this: ScanWorld) {
  assert.equal(
    this.fakes.store.files.has(cachePath(REPOSITORY, "alpha")),
    false,
  );
});

Then(
  "the summary lists Alpha as failed and Beta as ok",
  function (this: ScanWorld) {
    const [summary] = this.eventsOf("summary");
    const entries = summary?.phases.find(
      (one) => one.phase === "extract",
    )?.entries;

    assert.deepEqual(
      entries?.map((one) => [one.name, one.outcome]),
      [
        ["alpha", "failed"],
        ["beta", "ok"],
      ],
    );
  },
);

Then(
  "the Tally sensor runs after Alpha is extracted",
  function (this: ScanWorld) {
    const log = this.fakes.scanners.log;

    assert.ok(log.indexOf("extract:alpha") < log.indexOf("sense:tally"));
    assert.ok(log.includes("sense:tally"));
  },
);

Then("the Margin sensor does not run", function (this: ScanWorld) {
  assert.equal(
    this.fakes.sensors.ran.some((one) => one.name === "margin"),
    false,
  );
});

Then("the Tally sensor does not run", function (this: ScanWorld) {
  assert.equal(
    this.fakes.sensors.ran.some((one) => one.name === "tally"),
    false,
  );
});

Then(
  "the Tally sensor receives only the suite {string}",
  function (this: ScanWorld, suite: string) {
    const ran = this.fakes.sensors.ran.find((one) => one.name === "tally");

    assert.deepEqual(ran?.command.slice(1), [
      "--suites",
      JSON.stringify([suite]),
    ]);
  },
);

Then("the Margin sensor receives no suites", function (this: ScanWorld) {
  const ran = this.fakes.sensors.ran.find((one) => one.name === "margin");

  assert.deepEqual(ran?.command, ["margin"]);
});

Then("confirmation is asked", function (this: ScanWorld) {
  assert.equal(this.fakes.confirm.asked, 1);
});

Then("confirmation is not asked", function (this: ScanWorld) {
  assert.equal(this.fakes.confirm.asked, 0);
});

Then("nothing is described", function (this: ScanWorld) {
  assert.deepEqual(this.fakes.describer.described, []);
});

Then("every module is described", function (this: ScanWorld) {
  assert.equal(this.fakes.describer.described.length, 2);
});

Then("the scan is refused by preflight", function (this: ScanWorld) {
  assert.equal(this.outcome?.status, "refused");
  assert.equal(
    this.outcome?.status === "refused" && this.outcome.reason,
    "preflight",
  );
});

Then(
  "the gaps {string} and {string} are reported",
  function (this: ScanWorld, first: string, second: string) {
    const [event] = this.eventsOf("preflight").filter(
      (one) => one.state === "gaps",
    );

    assert.ok(event && event.state === "gaps");
    assert.deepEqual(
      event.gaps.map((gap) => gap.id),
      [first, second],
    );
  },
);

Then(
  "the second scan is refused because another scan holds the lock",
  function (this: ScanWorld) {
    assert.deepEqual(this.secondOutcome, { status: "refused", reason: "lock" });
  },
);

Then("the first scan's lock is untouched", function (this: ScanWorld) {
  const [first] = this.fakes.store.locks;

  assert.equal(this.fakes.store.locks.length, 1);
  assert.equal(first?.released, false);
  assert.equal(first?.phase, "running");

  this.fakes.sensors.releaseHeld();
});

Then(
  "the status reports a scan running in the running phase",
  function (this: ScanWorld) {
    assert.deepEqual(this.statusSeen, {
      running: true,
      phase: "running",
      sensors: ["tally"],
      describe: false,
      startedBy: "cli",
    });
  },
);

Then("the Tally sensor's process is stopped", function (this: ScanWorld) {
  assert.equal(this.fakes.process.stops, 1);
});

Then("the lock is released", function (this: ScanWorld) {
  assert.equal(this.fakes.store.locks[0]?.released, true);
});

Then("the scan ends stopped", function (this: ScanWorld) {
  assert.deepEqual(this.outcome, { status: "stopped" });
});

Then(
  "the summary lists the extract phase with the Alpha entry",
  function (this: ScanWorld) {
    const [summary] = this.eventsOf("summary");
    const extract = summary?.phases.find((one) => one.phase === "extract");

    assert.deepEqual(
      extract?.entries.map((one) => one.name),
      ["alpha"],
    );
  },
);

Then(
  "the summary lists the sense phase with the Tally entry",
  function (this: ScanWorld) {
    const [summary] = this.eventsOf("summary");
    const sense = summary?.phases.find((one) => one.phase === "sense");

    assert.deepEqual(
      sense?.entries.map((one) => one.name),
      ["tally"],
    );
  },
);

Then(
  "the summary lists the old Gamma scan as removed",
  function (this: ScanWorld) {
    const [summary] = this.eventsOf("summary");

    assert.deepEqual(summary?.removed, [cachePath(REPOSITORY, "gamma")]);
  },
);
