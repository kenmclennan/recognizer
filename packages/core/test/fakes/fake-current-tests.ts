import type { CurrentTests } from "../../src/index.js";

export class FakeCurrentTests implements CurrentTests {
  held: string | null = null;
  failures = 0;

  digest(): string | null {
    if (this.failures > 0) {
      this.failures -= 1;

      throw new Error("the manifest read timed out");
    }

    return this.held;
  }
}
