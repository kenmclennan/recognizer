import { createHash } from "node:crypto";
import type { Digest } from "@recognizer/core";

export class DigestAdapter implements Digest {
  sha1Prefix(text: string): string {
    return createHash("sha1")
      .update(text, "utf8")
      .digest()
      .subarray(0, 8)
      .toString("hex");
  }
}
