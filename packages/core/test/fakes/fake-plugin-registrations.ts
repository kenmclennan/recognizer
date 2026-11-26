import {
  type PluginKind,
  type PluginRegistrations,
  type RegisteredPlugin,
  type RegistrationFile,
  type RegistrationOutcome,
  type RegistrationSource,
  type RegistryEntries,
  registrationFileName,
  resolveRegistrations,
  serializeRegistration,
  type UnregisterOutcome,
} from "../../src/index.js";

const FOLDERS: Record<RegistrationSource, string> = {
  user: "/user",
  homebrew: "/homebrew",
};

interface Held {
  source: RegistrationSource;
  fileName: string;
  text: string;
  modified: number | null;
}

export class FakePluginRegistrations implements PluginRegistrations {
  readonly files: Held[] = [];
  readonly writes: RegisteredPlugin[] = [];

  place(
    source: RegistrationSource,
    fileName: string,
    text: string,
    modified: number | null,
  ): void {
    this.files.splice(
      0,
      this.files.length,
      ...this.files.filter(
        (held) => !(held.source === source && held.fileName === fileName),
      ),
      { source, fileName, text, modified },
    );
  }

  entries(): RegistryEntries {
    const files: RegistrationFile[] = this.files.map((held) => ({
      source: held.source,
      path: `${FOLDERS[held.source]}/${held.fileName}`,
      fileName: held.fileName,
      text: held.text,
      modified: held.modified,
    }));

    return resolveRegistrations([
      ...files.filter((file) => file.source === "user"),
      ...files.filter((file) => file.source === "homebrew"),
    ]);
  }

  register(entry: RegisteredPlugin): RegistrationOutcome {
    const fileName = registrationFileName(entry.kind, entry.name);

    const newest = Math.max(0, ...this.files.map((held) => held.modified ?? 0));

    this.writes.push(entry);
    this.place("user", fileName, serializeRegistration(entry), newest + 1);

    return { status: "registered", path: `${FOLDERS.user}/${fileName}` };
  }

  unregister(name: string, kind: PluginKind | undefined): UnregisterOutcome {
    const kinds: PluginKind[] =
      kind === undefined ? ["scanner", "sensor", "describer"] : [kind];
    const has = (source: RegistrationSource) =>
      kinds.filter((one) =>
        this.files.some(
          (held) =>
            held.source === source &&
            held.fileName === registrationFileName(one, name),
        ),
      );
    const user = has("user");

    if (user.length > 1) {
      return { status: "ambiguous", kinds: user };
    }

    if (user.length === 1) {
      const [only] = user as [PluginKind];
      const fileName = registrationFileName(only, name);
      const index = this.files.findIndex(
        (held) => held.source === "user" && held.fileName === fileName,
      );

      this.files.splice(index, 1);

      return { status: "removed", kind: only };
    }

    const homebrew = has("homebrew");

    if (homebrew.length > 1) {
      return { status: "ambiguous", kinds: homebrew };
    }

    return homebrew.length === 1
      ? { status: "homebrew-only", kind: homebrew[0] as PluginKind }
      : { status: "not-registered" };
  }
}
