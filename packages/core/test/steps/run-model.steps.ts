import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import {
  type RepositoryState,
  RepositoryStateHolder,
} from "../../src/index.js";
import { repositoryStateDependenciesOf } from "../fakes/container.js";
import type { ScanWorld } from "../fakes/world.js";
import { REPOSITORY } from "../fakes/world.js";
import { findingsOf } from "../run-model/support.js";

const SENSORS = ["first", "second", "third"];

interface Trial {
  holder: RepositoryStateHolder;
  seen: RepositoryState[];
  before: RepositoryState | null;
  saved: number;
}

const trials = new WeakMap<object, Trial>();

function holderOf(world: ScanWorld): RepositoryStateHolder {
  const { fakes } = world;

  return new RepositoryStateHolder(
    REPOSITORY,
    repositoryStateDependenciesOf(fakes),
  );
}

function trial(world: ScanWorld): Trial {
  const held = trials.get(world);

  assert.ok(held !== undefined, "a run was set up");

  return held;
}

function begin(world: ScanWorld, scope: "working-tree" | "commit"): void {
  for (const name of SENSORS) {
    world.addSensor(name, false);
  }

  world.fakes.findings.save(REPOSITORY, findingsOf("first", { "a.py": "h1" }));
  world.fakes.active.start({
    sensors: SENSORS,
    phase: "running",
    scope:
      scope === "commit"
        ? { kind: "commit", commit: "abc123" }
        : { kind: "working-tree" },
  });

  const holder = holderOf(world);
  const seen: RepositoryState[] = [];

  holder.subscribe((state) => seen.push(state));
  trials.set(world, {
    holder,
    seen,
    before: holder.current(),
    saved: world.fakes.findings.saved.length,
  });
}

Given("three registered plugins in a run", function (this: ScanWorld) {
  begin(this, "working-tree");
});

Given(
  "three registered plugins in a commit-scoped run",
  function (this: ScanWorld) {
    begin(this, "commit");
  },
);

When(
  "the first plugin finishes with a result and the second starts",
  function (this: ScanWorld) {
    const { active } = this.fakes;

    active.report(
      { kind: "plugin-started", name: "first", progress: null },
      { kind: "plugin-ended", name: "first", state: "finished" },
      { kind: "plugin-started", name: "second", progress: null },
    );
    trial(this).holder.refresh();
  },
);

When(
  "the first plugin reports three stages and one estimate of 3 hours",
  function (this: ScanWorld) {
    const { active } = this.fakes;
    const { holder } = trial(this);

    active.report(
      { kind: "plugin-started", name: "first", progress: null },
      { kind: "plugin-estimate", name: "first", estimateMs: 10_800_000 },
    );
    holder.refresh();

    for (const index of [1, 2, 3]) {
      active.report({
        kind: "plugin-stage",
        name: "first",
        stage: { name: `stage ${index}`, index, of: 3 },
      });
      holder.refresh();
    }
  },
);

When("the plugin catalog cannot be read", function (this: ScanWorld) {
  this.fakes.catalog.failReads = true;
  trial(this).holder.refresh();
});

When("the service restarts", function (this: ScanWorld) {
  const held = trial(this);

  held.before = held.holder.current();
  held.holder = holderOf(this);
});

When(
  "the state is refreshed twice with nothing changed",
  function (this: ScanWorld) {
    const { holder } = trial(this);

    holder.refresh();
    holder.refresh();
  },
);

When("the second plugin reports a progress line", function (this: ScanWorld) {
  this.fakes.active.report(
    { kind: "plugin-started", name: "first", progress: null },
    { kind: "plugin-ended", name: "first", state: "finished" },
    { kind: "plugin-started", name: "second", progress: null },
    {
      kind: "plugin-progress",
      name: "second",
      progress: { done: 1, total: 2, unit: "files" },
    },
  );
  trial(this).holder.refresh();
});

When("the run's owner is found gone", function (this: ScanWorld) {
  this.fakes.runLog.openRecord("run-1");
  this.fakes.active.kill();
  trial(this).holder.refresh();
});

When(
  "the first plugin reports a result for the commit",
  function (this: ScanWorld) {
    this.fakes.active.report(
      { kind: "plugin-started", name: "first", progress: null },
      {
        kind: "plugin-result",
        name: "first",
        at: { commit: "abc123", modified: false },
        result: {
          findings: null,
          overlay: null,
          inputsDigest: null,
          testsDigest: null,
          reportedAt: null,
          inputs: null,
        },
      },
    );
    trial(this).holder.refresh();
  },
);

Then(
  "every revision lists all three registered plugins",
  function (this: ScanWorld) {
    for (const state of trial(this).seen) {
      assert.deepEqual(
        state.registry.entries.map(({ name }) => name),
        SENSORS,
      );
    }
  },
);

Then("the first plugin's result is in the state", function (this: ScanWorld) {
  assert.equal(trial(this).holder.current().results.first?.results.length, 1);
});

Then(
  "the plugin runs read finished, running and queued",
  function (this: ScanWorld) {
    assert.deepEqual(
      trial(this)
        .holder.current()
        .run?.plugins.map(({ state }) => state),
      ["finished", "running", "queued"],
    );
  },
);

Then(
  "every revision carries the estimate of 10800000 and a stage index that never falls",
  function (this: ScanWorld) {
    let index = 0;
    let seenStage = false;

    for (const state of trial(this).seen) {
      const plugin = state.run?.plugins.find(({ name }) => name === "first");

      if (plugin === undefined || plugin.state !== "running") {
        continue;
      }

      assert.equal(plugin.estimateMs, 10_800_000);

      const now = plugin.stage?.index ?? 0;

      assert.ok(now >= index);
      index = now;
      seenStage ||= now > 0;
    }

    assert.equal(index, 3);
    assert.ok(seenStage);
  },
);

Then("the catalog reads unreadable", function (this: ScanWorld) {
  assert.equal(
    trial(this).holder.current().registry.catalog.state,
    "unreadable",
  );
});

Then(
  "the state still lists all three registered plugins",
  function (this: ScanWorld) {
    const state = trial(this).holder.current();

    assert.deepEqual(
      state.registry.entries.map(({ name }) => name),
      SENSORS,
    );
    assert.equal(state.results.first?.results.length, 1);
  },
);

Then(
  "the restarted state is revision 1 and equals the old state without its revision",
  function (this: ScanWorld) {
    const held = trial(this);
    const { revision, ...fresh } = held.holder.current();
    const { revision: _old, ...old } = held.before as RepositoryState;

    assert.equal(revision, 1);
    assert.deepEqual(fresh, old);
  },
);

Then("one revision was published", function (this: ScanWorld) {
  assert.equal(trial(this).holder.current().revision, 1);
});

Then("the next revision was published", function (this: ScanWorld) {
  assert.equal(trial(this).holder.current().revision, 2);
});

Then("the run ends stopped", function (this: ScanWorld) {
  assert.equal(trial(this).holder.current().run?.state, "stopped");
});

Then("both repositories settled the run once", function (this: ScanWorld) {
  trial(this).holder.refresh();
  assert.equal(this.fakes.runLog.settledKills.length, 1);
  assert.deepEqual(this.fakes.active.settled, ["run-1"]);
});

Then("the working-tree result is unchanged", function (this: ScanWorld) {
  const held = trial(this);
  const now = held.holder.current().results.first?.results ?? [];
  const old = held.before?.results.first?.results ?? [];

  assert.deepEqual(
    now.filter(({ commit }) => commit === "c0ffee"),
    old,
  );
  assert.equal(now.length, old.length + 1);
});

Then(
  "no findings document was saved for the commit",
  function (this: ScanWorld) {
    assert.equal(this.fakes.findings.saved.length, trial(this).saved);
  },
);
