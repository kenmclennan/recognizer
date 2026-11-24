import { InvalidEntity } from "../invalid-entity.js";

export type CatalogState =
  | { state: "read" }
  | { state: "unreadable"; reason: string };

export interface ManifestFacts {
  display: string;
  runsTests: boolean;
  scoped: boolean;
  listed: boolean;
}

export interface RegistryEntry {
  name: string;
  registered: boolean;
  manifest: ManifestFacts | null;
  reason: string | null;
}

export interface SensorRegistryView {
  catalog: CatalogState;
  entries: RegistryEntry[];
}

export interface InstalledFacts {
  readable: ReadonlyMap<string, ManifestFacts>;
  unreadable: ReadonlyMap<string, string>;
}

export class SensorRegistry {
  readonly entries: readonly RegistryEntry[];

  constructor(
    readonly registered: readonly string[],
    entries: readonly RegistryEntry[],
    readonly catalog: CatalogState,
  ) {
    const listed = new Set(entries.map(({ name }) => name));

    for (const name of registered) {
      if (!listed.has(name)) {
        throw new InvalidEntity(
          "SensorRegistry",
          "every registered plugin is listed",
          name,
        );
      }
    }

    if (listed.size !== entries.length) {
      throw new InvalidEntity(
        "SensorRegistry",
        "a plugin is listed once",
        entries.map(({ name }) => name).join(", "),
      );
    }

    this.entries = [...entries];
  }

  static unknown(): SensorRegistry {
    return new SensorRegistry([], [], { state: "read" });
  }

  static read(
    registered: readonly string[],
    installed: InstalledFacts,
  ): SensorRegistry {
    const names = new Set(registered);
    const entries: RegistryEntry[] = registered.map((name) => {
      const manifest = installed.readable.get(name);
      const reason = installed.unreadable.get(name);

      if (manifest !== undefined) {
        return { name, registered: true, manifest, reason: null };
      }

      return {
        name,
        registered: true,
        manifest: null,
        reason: reason ?? "the plugin is not installed",
      };
    });
    const others: RegistryEntry[] = [
      ...[...installed.readable.entries()]
        .filter(([name, facts]) => !names.has(name) && facts.listed)
        .map(([name, manifest]) => ({
          name,
          registered: false,
          manifest,
          reason: null,
        })),
      ...[...installed.unreadable.entries()]
        .filter(([name]) => !names.has(name))
        .map(([name, reason]) => ({
          name,
          registered: false,
          manifest: null,
          reason,
        })),
    ].sort((a, b) =>
      (a.manifest?.display ?? a.name).localeCompare(
        b.manifest?.display ?? b.name,
      ),
    );

    return new SensorRegistry(registered, [...entries, ...others], {
      state: "read",
    });
  }

  unreadable(
    reason: string,
    names: readonly string[] = this.registered,
  ): SensorRegistry {
    const kept = new Map(this.entries.map((entry) => [entry.name, entry]));
    const entries: RegistryEntry[] = names.map((name) => {
      const held = kept.get(name);

      return held !== undefined && held.manifest !== null
        ? { ...held, registered: true }
        : {
            name,
            registered: true,
            manifest: null,
            reason: `the plugin catalog cannot be read: ${reason}`,
          };
    });
    const others = this.entries.filter(
      (entry) => !names.includes(entry.name) && !entry.registered,
    );

    return new SensorRegistry(names, [...entries, ...others], {
      state: "unreadable",
      reason,
    });
  }

  view(): SensorRegistryView {
    return {
      catalog: this.catalog,
      entries: this.entries.map((entry) => ({ ...entry })),
    };
  }
}
