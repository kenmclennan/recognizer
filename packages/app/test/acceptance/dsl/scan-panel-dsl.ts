import { World } from "@cucumber/cucumber";
import {
  FrontEndDriver,
  type InstalledSensor,
  type StartedScan,
} from "../driver/front-end-driver";

export type Describes = "nothing" | "all files" | "changed files only";

export class ScanPanelWorld extends World {
  private sensors: InstalledSensor[] = [];
  private suites: string[] = [];
  private described: string[] = [];
  private undescribed: string[] = [];
  private driver: FrontEndDriver | null = null;
  private last: StartedScan | null = null;

  install(names: string[], runsTests: boolean) {
    this.sensors = names.map((name) => ({ name, runsTests }));
  }

  withSuites(names: string[]) {
    this.suites = names;
  }

  withFiles(described: string[], undescribed: string[]) {
    this.described = described;
    this.undescribed = undescribed;
  }

  get panel(): FrontEndDriver {
    this.driver ??= new FrontEndDriver({
      sensors: this.sensors,
      suites: this.suites,
      describedFiles: this.described,
      undescribedFiles: this.undescribed,
    });

    return this.driver;
  }

  async scan() {
    this.last = await this.panel.startScan();
  }

  private get started(): StartedScan {
    if (this.last === null) {
      throw new Error("No scan has started");
    }

    return this.last;
  }

  expectSenses(expected: string[]) {
    expectEqual(
      [...this.started.senses].sort(),
      [...expected].sort(),
      "the sensors sensed",
    );
  }

  expectDescribes(expected: Describes) {
    const scan = this.started;
    const actual = !scan.describes
      ? "nothing"
      : scan.describesAll
        ? "all files"
        : sameSet(scan.describedFiles, this.undescribed)
          ? "changed files only"
          : `the files ${scan.describedFiles.join(", ")}`;

    expectEqual(actual, expected, "what the scan describes");
  }

  expectSuites(sensor: string, expected: string[]) {
    expectEqual(
      this.started.suitesOf(sensor),
      expected,
      `the suites ${sensor} runs`,
    );
  }
}

function sameSet(a: string[], b: string[]): boolean {
  return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
}

function expectEqual(actual: unknown, expected: unknown, what: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);

  if (a !== e) {
    throw new Error(`Expected ${what} to be ${e} but it was ${a}`);
  }
}
