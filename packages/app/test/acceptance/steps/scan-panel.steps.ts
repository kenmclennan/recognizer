import {
  defineParameterType,
  Given,
  setWorldConstructor,
  Then,
  When,
} from "@cucumber/cucumber";
import { type Describes, ScanPanelWorld } from "../dsl/scan-panel-dsl";

setWorldConstructor(ScanPanelWorld);

const list = (text: string) => (text === "nothing" ? [] : text.split(" and "));

defineParameterType({
  name: "sensors",
  regexp: /nothing|(?!Descriptions\b)[A-Z][\w.]*(?: and [A-Z][\w.]*)*/,
  transformer: list,
});

defineParameterType({
  name: "names",
  regexp: /[\w.]+(?: and [\w.]+)*/,
  transformer: list,
});

defineParameterType({
  name: "describes",
  regexp: /nothing|all files|changed files only/,
  transformer: (text) => text as Describes,
});

defineParameterType({
  name: "mode",
  regexp: /Incremental|Full/,
  transformer: (text) => text as "Incremental" | "Full",
});

Given(
  "the installed sensors {sensors} both run the test suites",
  function (this: ScanPanelWorld, names: string[]) {
    this.install(names, true);
  },
);

Given(
  "a repository with the test suites {names}",
  function (this: ScanPanelWorld, names: string[]) {
    this.withSuites(names);
  },
);

Given(
  "the files {names} have descriptions and {names} has none",
  function (this: ScanPanelWorld, described: string[], undescribed: string[]) {
    this.withFiles(described, undescribed);
  },
);

Given("Descriptions is ticked", function (this: ScanPanelWorld) {
  this.panel.tickDescriptions();
});

Given(
  "{sensors} is ticked",
  function (this: ScanPanelWorld, sensors: string[]) {
    for (const sensor of sensors) this.panel.tick(sensor);
  },
);

Given(
  "{sensors} is unticked",
  function (this: ScanPanelWorld, sensors: string[]) {
    for (const sensor of sensors) this.panel.untick(sensor);
  },
);

Given(
  "the suite {word} is ticked under {sensors}",
  function (this: ScanPanelWorld, suite: string, [sensor]: string[]) {
    this.panel.tickSuite(sensor as string, suite);
  },
);

Given("the mode is {mode}", function (this: ScanPanelWorld, mode) {
  this.panel.chooseMode(mode);
});

Given("the panel shows its plan", function (this: ScanPanelWorld) {
  this.panel.showPlan();
});

When(/^(?:a|another) scan runs$/, async function (this: ScanPanelWorld) {
  await this.scan();
});

Then(
  "the scan senses {sensors}",
  function (this: ScanPanelWorld, sensors: string[]) {
    this.expectSenses(sensors);
  },
);

Then(
  "the scan describes {describes}",
  function (this: ScanPanelWorld, describes: Describes) {
    this.expectDescribes(describes);
  },
);

Then(
  "{sensors} runs only the suite {word}",
  function (this: ScanPanelWorld, [sensor]: string[], suite: string) {
    this.expectSuites(sensor as string, [suite]);
  },
);
