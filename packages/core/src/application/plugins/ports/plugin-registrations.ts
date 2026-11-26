import type { PluginKind } from "../../../domain/plugins/manifest.js";
import type {
  RegisteredPlugin,
  RegistryEntries,
} from "../../../domain/plugins/registration.js";

export type RegistrationOutcome =
  | { status: "registered"; path: string }
  | { status: "refused"; reason: string };

export type UnregisterOutcome =
  | { status: "removed"; kind: PluginKind }
  | { status: "homebrew-only"; kind: PluginKind }
  | { status: "not-registered" }
  | { status: "ambiguous"; kinds: PluginKind[] };

export interface PluginRegistrations {
  entries(): RegistryEntries;
  register(entry: RegisteredPlugin): RegistrationOutcome;
  unregister(name: string, kind: PluginKind | undefined): UnregisterOutcome;
}
