import {
  joinPath as join,
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
} from "@recognizer/core";
import type { Io } from "../../cli.js";
import { saveRepositoryText } from "./save-repository-text.js";

const HOMEBREW_FOLDER = "/opt/homebrew/share/recognizer/plugins";

export function registrationFolders(io: Io): {
  homebrew: string;
  user: string;
} {
  const override = io.env("RECOGNIZER_PLUGIN_DIRS");

  if (override !== undefined && override !== "") {
    const [homebrew = "", user = ""] = override.split(":");

    return { homebrew, user };
  }

  return {
    homebrew: HOMEBREW_FOLDER,
    user: join(io.env("HOME") ?? "", ".config", "recognizer", "plugins"),
  };
}

export class PluginRegistrationsAdapter implements PluginRegistrations {
  constructor(private readonly io: Io) {}

  private filesIn(
    folder: string,
    source: RegistrationSource,
  ): RegistrationFile[] {
    if (folder === "" || !this.io.exists(folder)) {
      return [];
    }

    return this.io
      .readDir(folder)
      .filter((entry) => entry.kind === "file" && entry.name.endsWith(".json"))
      .map((entry) => {
        const path = join(folder, entry.name);
        let text = "";

        try {
          text = this.io.readFile(path);
        } catch {
          text = "";
        }

        return {
          source,
          path,
          fileName: entry.name,
          text,
          modified:
            this.io.modified === undefined ? null : this.io.modified(path),
        };
      });
  }

  entries(): RegistryEntries {
    const folders = registrationFolders(this.io);

    return resolveRegistrations([
      ...this.filesIn(folders.user, "user"),
      ...this.filesIn(folders.homebrew, "homebrew"),
    ]);
  }

  register(entry: RegisteredPlugin): RegistrationOutcome {
    const { user } = registrationFolders(this.io);

    if (user === "") {
      return {
        status: "refused",
        reason: "there is no user folder to write to",
      };
    }

    const path = join(user, registrationFileName(entry.kind, entry.name));

    saveRepositoryText(this.io, path, serializeRegistration(entry));

    return { status: "registered", path };
  }

  unregister(name: string, kind: PluginKind | undefined): UnregisterOutcome {
    const folders = registrationFolders(this.io);
    const kinds: PluginKind[] =
      kind === undefined ? ["scanner", "sensor", "describer"] : [kind];
    const user = kinds.filter((one) =>
      this.io.exists(join(folders.user, registrationFileName(one, name))),
    );

    if (user.length > 1) {
      return { status: "ambiguous", kinds: user };
    }

    if (user.length === 1) {
      const [only] = user as [PluginKind];

      this.io.remove(join(folders.user, registrationFileName(only, name)));

      return { status: "removed", kind: only };
    }

    const homebrew = kinds.filter((one) =>
      this.io.exists(join(folders.homebrew, registrationFileName(one, name))),
    );

    if (homebrew.length > 1) {
      return { status: "ambiguous", kinds: homebrew };
    }

    return homebrew.length === 1
      ? { status: "homebrew-only", kind: homebrew[0] as PluginKind }
      : { status: "not-registered" };
  }
}
