import { fileURLToPath } from "node:url";
import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { newWorld } from "../dsl/scan-panel-dsl";

const feature = await loadFeature(
  fileURLToPath(new URL("./scan-panel.feature", import.meta.url)),
);

describeFeature(feature, ({ Background, Scenario, ScenarioOutline }) => {
  let world = newWorld();

  Background(({ Given, And }) => {
    Given("a repository with the test suites unit and web", () => {
      world = newWorld();
      world.repository.withSuites("unit", "web");
    });
    And("the files a.py and b.py have descriptions and c.py has none", () => {
      world.repository
        .withDescribedFiles("a.py", "b.py")
        .withUndescribedFiles("c.py");
    });
    And("Descriptions is ticked", () => {
      world.panel.tickDescriptions();
    });
  });

  Scenario(
    "An unticked sensor is not sensed even though its suites stay ticked",
    ({ Given, When, And, Then }) => {
      Given("Mutation is ticked", () => world.panel.tick("Mutation"));
      When("a scan runs", () => world.startScan());
      And("another scan runs", () => world.startScan());
      Then("the scan senses nothing", () => world.scan.expectSenses("nothing"));
    },
  );

  Scenario(
    "Ticking a suite inside an unticked sensor's fold turns the sensor on",
    ({ When, And, Then }) => {
      When("the suite unit is ticked under Mutation", () =>
        world.panel.tickSuite("Mutation", "unit"),
      );
      And("a scan runs", () => world.startScan());
      Then("the scan senses Mutation", () =>
        world.scan.expectSenses("Mutation"),
      );
      And("Mutation runs only the suite unit", () =>
        world.scan.expectSuites("Mutation", "unit"),
      );
    },
  );

  Scenario(
    "A plan shown before a sensor is unticked does not sense it",
    ({ Given, And, When, Then }) => {
      Given("Mutation is ticked", () => world.panel.tick("Mutation"));
      And("the panel shows its plan", () => world.panel.showPlan());
      And("Mutation is unticked", () => world.panel.untick("Mutation"));
      When("a scan runs", () => world.startScan());
      Then("the scan senses nothing", () => world.scan.expectSenses("nothing"));
    },
  );

  ScenarioOutline(
    "What a scan senses and describes",
    ({ Given, And, When, Then }, variables) => {
      Given("<ticked> is ticked", () => world.panel.tickAll(variables.ticked));
      And("<unticked> is unticked", () =>
        world.panel.untickAll(variables.unticked),
      );
      And("the mode is <mode>", () => world.panel.chooseMode(variables.mode));
      When("a scan runs", () => world.startScan());
      Then("the scan senses <senses>", () =>
        world.scan.expectSenses(variables.senses),
      );
      And("the scan describes <describes>", () =>
        world.scan.expectDescribes(variables.describes),
      );
    },
  );
});
