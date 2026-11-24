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

  schemas(): { schema: KeySchema; notAnswering: string[] } {
    return { schema: this.schema, notAnswering: this.notAnswering };
  }
}
