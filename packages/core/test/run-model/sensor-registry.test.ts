import { describe, expect, it } from "vitest";
import {
  type InstalledFacts,
  InvalidEntity,
  type ManifestFacts,
  SensorRegistry,
} from "../../src/index.js";
import { fakesWith } from "./support.js";

const FACTS: ManifestFacts = {
  display: "Tally",
  runsTests: false,
  scoped: false,
  listed: true,
};

function installed(
  readable: Record<string, ManifestFacts>,
  unreadable: Record<string, string> = {},
): InstalledFacts {
  return {
    readable: new Map(Object.entries(readable)),
    unreadable: new Map(Object.entries(unreadable)),
  };
}

describe("sensor registry", () => {
  it("a_registered_plugin_is_always_listed", () => {
    const registry = SensorRegistry.read(
      ["tally", "margin"],
      installed({ tally: FACTS }),
    );

    expect(registry.entries.map(({ name }) => name)).toEqual([
      "tally",
      "margin",
    ]);
    expect(registry.entries[1]).toMatchObject({
      registered: true,
      manifest: null,
    });
    expect(registry.entries[1]?.reason).not.toBeNull();
    expect(
      () => new SensorRegistry(["tally", "margin"], [], { state: "read" }),
    ).toThrow(InvalidEntity);
  });

  it("an_unreadable_catalog_is_a_state_and_keeps_every_registered_plugin", () => {
    const fakes = fakesWith("tally", "margin");
    const registered = ["tally", "margin"];
    const good = SensorRegistry.read(
      registered,
      installed({ tally: FACTS, margin: { ...FACTS, display: "Margin" } }),
    );

    fakes.catalog.readInstalled();
    fakes.catalog.failReads = true;

    let reason = "";

    try {
      fakes.catalog.readInstalled();
    } catch (error) {
      reason = (error as Error).message;
    }

    const registry = good.unreadable(reason);

    expect(registry.entries).toHaveLength(registered.length);
    expect(registry.catalog).toEqual({ state: "unreadable", reason });
  });

  it("an_unreadable_catalog_keeps_the_last_read_manifest", () => {
    const good = SensorRegistry.read(["tally"], installed({ tally: FACTS }));
    const registry = good.unreadable("the plugin listing failed");

    expect(registry.entries[0]?.manifest).toEqual(FACTS);
    expect(registry.catalog.state).toBe("unreadable");

    const fresh = SensorRegistry.unknown().unreadable("the listing failed", [
      "tally",
    ]);

    expect(fresh.entries[0]).toMatchObject({ name: "tally", manifest: null });
  });

  it("an_unreadable_installed_plugin_is_an_entry_not_a_missing_row", () => {
    const registry = SensorRegistry.read(
      ["tally"],
      installed(
        { tally: FACTS },
        { broken: "the manifest is not valid", tally2: "no manifest" },
      ),
    );
    const broken = registry.entries.find(({ name }) => name === "broken");

    expect(broken).toMatchObject({ manifest: null, registered: false });
    expect(broken?.reason).toBe("the manifest is not valid");

    const registeredBroken = SensorRegistry.read(
      ["broken"],
      installed({}, { broken: "the manifest is not valid" }),
    );

    expect(registeredBroken.entries).toHaveLength(1);
    expect(registeredBroken.entries[0]).toMatchObject({
      registered: true,
      manifest: null,
      reason: "the manifest is not valid",
    });
  });

  it("an_installed_plugin_that_is_not_registered_is_listed_unregistered", () => {
    const registry = SensorRegistry.read(
      [],
      installed({ tally: FACTS, hidden: { ...FACTS, listed: false } }),
    );

    expect(registry.entries.map(({ name }) => name)).toEqual(["tally"]);
    expect(registry.entries[0]?.registered).toBe(false);
  });
});
