import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { nextVersion } from "./next-version.mjs";

describe("nextVersion", () => {
  it("gives the committed version when there is no release", () => {
    expect(nextVersion("0.1.0", [])).toBe("0.1.0");
  });

  it("gives the committed version when it is greater than the last release", () => {
    expect(nextVersion("0.2.0", ["v0.1.7"])).toBe("0.2.0");
  });

  it("increments the patch when the committed version equals the last release", () => {
    expect(nextVersion("0.1.7", ["v0.1.7"])).toBe("0.1.8");
  });

  it("increments the patch of the last release when the committed version is less", () => {
    expect(nextVersion("0.1.0", ["v0.1.7"])).toBe("0.1.8");
  });

  it("compares multi-digit parts numerically", () => {
    expect(nextVersion("0.9.9", ["v0.9.9", "v0.10.0"])).toBe("0.10.1");
    expect(nextVersion("0.10.0", ["v0.9.9"])).toBe("0.10.0");
  });

  it("ignores tags that do not match vX.Y.Z", () => {
    expect(nextVersion("0.1.0", ["v1.0.0-rc1", "nightly", "1.2.3"])).toBe(
      "0.1.0",
    );
    expect(nextVersion("0.1.0", ["v1.0.0-rc1", "v0.1.7"])).toBe("0.1.8");
  });

  it("gives the version committed in tauri.conf.json when there is no release", () => {
    const conf = JSON.parse(
      readFileSync(
        new URL("../src-tauri/tauri.conf.json", import.meta.url),
        "utf8",
      ),
    );

    expect(nextVersion(conf.version, [])).toBe(conf.version);
  });
});
