import type { KeyOwners, KeySchema } from "../../src/index.js";

export class FakeKeyOwners implements KeyOwners {
  schema: KeySchema = {
    keys_version: 1,
    owner: "sensors",
    placeholders: { name: "^.+$" },
    sections: [],
    keys: [],
  };

  notAnswering: string[] = [];

  reads = 0;

  schemas(): { schema: KeySchema; notAnswering: string[] } {
    this.reads += 1;

    return { schema: this.schema, notAnswering: this.notAnswering };
  }
}
