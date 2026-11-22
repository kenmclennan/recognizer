import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { scanOf, ticksOf } from "../fakes/plan-world.js";
import type { ScanWorld } from "../fakes/world.js";

const FILES = { "a.py": "ha", "b.py": "hb", "c.py": "hc" };

const lower = (word: string): string => word.toLowerCase();

function view(world: ScanWorld) {
  assert.ok(world.view !== null, "a plan was made");

  return world.view;
}

Given("a planned repository with three files", function (this: ScanWorld) {
  this.plans.seedScan(scanOf(FILES, Object.keys(FILES)));
});

Given("a planned repository with no files", function (this: ScanWorld) {
  this.plans.seedScan(scanOf({}, []));
});

Given(
  "Tally and Margin sensors are registered and ticked",
  function (this: ScanWorld) {
    this.plans.addSensor("tally");
    this.plans.addSensor("margin");
    this.ticked = ["tally", "margin"];
  },
);

Given("Tally is current on every file", function (this: ScanWorld) {
  this.plans.measure("tally", { inputs: FILES });
});

Given("Margin is current on every file", function (this: ScanWorld) {
  this.plans.measure("margin", { inputs: FILES });
});

Given("Margin is out of date on one file", function (this: ScanWorld) {
  this.plans.measure("margin", { inputs: { ...FILES, "b.py": "old" } });
});

Given("Ghost is ticked but no sensor registers it", function (this: ScanWorld) {
  this.ticked = [...this.ticked, "ghost"];
});

When("a rescan is planned", async function (this: ScanWorld) {
  this.view = await this.plans.plan({
    mode: "rescan",
    ticks: ticksOf({ ticked: this.ticked }),
  });
});

When("a bring is planned", async function (this: ScanWorld) {
  this.view = await this.plans.plan({
    mode: "bring",
    ticks: ticksOf({ ticked: this.ticked }),
  });
});

Then(
  /^the plan names (\w+) and (\w+)$/,
  function (this: ScanWorld, first: string, second: string) {
    assert.deepEqual(view(this).intent.sense, [lower(first), lower(second)]);
  },
);

Then(/^the plan names (\w+)$/, function (this: ScanWorld, name: string) {
  assert.deepEqual(view(this).intent.sense, [lower(name)]);
});

Then(
  /^the plan does not name (\w+)$/,
  function (this: ScanWorld, name: string) {
    assert.ok(!view(this).intent.sense.includes(lower(name)));
  },
);

Then("the plan names no sensor", function (this: ScanWorld) {
  assert.deepEqual(view(this).intent.sense, []);
});

Then("the plan covers {int} files", function (this: ScanWorld, count: number) {
  assert.equal(view(this).modules, count);
});

Then(
  /^the plan lists (\w+) and (\w+) as never run$/,
  function (this: ScanWorld, first: string, second: string) {
    assert.deepEqual(view(this).never, [lower(first), lower(second)]);
  },
);

Then("{word} is dropped", function (this: ScanWorld, name: string) {
  assert.deepEqual(view(this).dropped, [lower(name)]);
});

Then("the plan is idle", function (this: ScanWorld) {
  assert.equal(view(this).idle, true);
});
