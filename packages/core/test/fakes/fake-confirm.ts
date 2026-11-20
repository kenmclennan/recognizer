import type { Confirm } from "../../src/index.js";

export class FakeConfirm implements Confirm {
  asked = 0;

  constructor(public answer: boolean) {}

  ask(): Promise<boolean> {
    this.asked += 1;

    return Promise.resolve(this.answer);
  }
}
