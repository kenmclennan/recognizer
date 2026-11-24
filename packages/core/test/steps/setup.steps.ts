import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import {
  applySetup,
  buildChanges,
  rehearsalChanges,
  type SetupRunOutcome,
  type Survey,
  surveySetup,
  trySetup,
} from "../../src/index.js";
import {
  changesFor,
  runWorldOf,
  type SetupRunWorld,
  surveyOf,
} from "../configuration/setup-run-world.js";
import { ROOT, worldOf } from "../configuration/world.js";
import type { ScanWorld } from "../fakes/world.js";

interface SetupState {
  world: SetupRunWorld | null;
  survey: Survey | null;
  before: string;
  outcome: SetupRunOutcome<unknown> | null;
  failSecond: boolean;
}

const states = new WeakMap<ScanWorld, SetupState>();

function state(world: ScanWorld): SetupState {
  let found = states.get(world);

  if (found === undefined) {
    found = {
      world: null,
      survey: null,
      before: "",
      outcome: null,
      failSecond: false,
    };
    states.set(world, found);
  }

  return found;
}

function surveyWorld(held: SetupState): SetupRunWorld {
  if (held.world === null) {
    held.world = {
      ...worldOf(),
      started: [],
      uninstalled: [],
      insideCheck: [],
    };
  }

  return held.world;
}

Given(
  "a repository holding the file {string}",
  function (this: ScanWorld, path: string) {
    surveyWorld(state(this)).fakes.setupFiles.seed(`${ROOT}/${path}`, "");
  },
);

Given(
  "a plugin answers a vitest runner for {string}",
  function (this: ScanWorld, directory: string) {
    surveyWorld(state(this)).fakes.surveyPlugins.seeded = [
      {
        plugin: "typescript",
        order: 1,
        language: "typescript",
        answer: {
          runners: [
            {
              language: "typescript",
              runner: "vitest",
              settings: { runner: "vitest" },
              directory,
              from: `${directory}/package.json`,
              command: "npx vitest run",
              coverage: { path: "c/lcov.info", format: "lcov" },
              tool: null,
            },
          ],
          tools: [],
          notes: [],
        },
      },
    ];
  },
);

When("the repository is surveyed", async function (this: ScanWorld) {
  const held = state(this);

  held.survey = await surveySetup(surveyWorld(held).ports, { root: ROOT });
});

Then(
  "the survey lists the runner {string} from {string}",
  function (this: ScanWorld, name: string, from: string) {
    const runner = state(this).survey?.runners.find((one) => one.name === name);

    assert.equal(runner?.from, from);
  },
);

Then("the survey has no note", function (this: ScanWorld) {
  assert.deepEqual(state(this).survey?.notes, []);
});

Given("a repository set up for a change run", function (this: ScanWorld) {
  state(this).failSecond = false;
});

Given("the second step of the run fails", function (this: ScanWorld) {
  state(this).failSecond = true;
});

function prepared(held: SetupState): SetupRunWorld {
  held.world = runWorldOf(
    held.failSecond ? (_argv, index) => index === 1 : null,
  );
  held.before = held.world.fakes.setupFiles.snapshot();

  return held.world;
}

When("the changes are applied", async function (this: ScanWorld) {
  const held = state(this);
  const world = prepared(held);

  held.outcome = await applySetup(world.ports, {
    root: ROOT,
    changes: changesFor(),
    onEvent: () => {},
  });
});

When("the changes are tried", async function (this: ScanWorld) {
  const held = state(this);
  const world = prepared(held);
  const survey = surveyOf();

  held.outcome = await trySetup(world.ports, {
    root: ROOT,
    changes: rehearsalChanges(
      survey,
      buildChanges(
        survey,
        {
          analysis: { on: true, limits: { pair_min_lines: 12 } },
          plugins: ["crap"],
          runners: [{ name: "tauri" }, { name: "engine" }],
          tools: ["@vitest/coverage-v8", "cargo-llvm-cov"],
        },
        "claude",
      ).changes,
    ),
    onEvent: () => {},
  });
});

Then("the apply fails", function (this: ScanWorld) {
  assert.deepEqual(
    { status: state(this).outcome?.status, ok: ok(state(this)) },
    { status: "finished", ok: false },
  );
});

Then("the try passes", function (this: ScanWorld) {
  assert.deepEqual(
    { status: state(this).outcome?.status, ok: ok(state(this)) },
    { status: "finished", ok: true },
  );
});

Then("the files are byte-identical to before", function (this: ScanWorld) {
  const held = state(this);

  assert.equal(held.world?.fakes.setupFiles.snapshot(), held.before);
});

function ok(held: SetupState): boolean | null {
  return held.outcome?.status === "finished" ? held.outcome.ok : null;
}
