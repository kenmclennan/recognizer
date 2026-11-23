import { createHash } from "node:crypto";
import type { Digest } from "../../src/index.js";

export class FakeDigest implements Digest {
  sha1Prefix(text: string): string {
    return createHash("sha1")
      .update(text, "utf8")
      .digest()
      .subarray(0, 8)
      .toString("hex");
  }

  sha256(data: Uint8Array | string): string {
    return createHash("sha256").update(data).digest("hex");
  }
}
