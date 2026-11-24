import type { Io } from "./cli.js";
import { loadKeys } from "./config-keys.js";
import {
  type KeyedCommand,
  keysHelp,
  runKeyed,
  usageFor,
} from "./key-command.js";

const CONFIG: KeyedCommand = {
  noun: "config",
  usage: usageFor("config", true),
  schema: true,
};

export function runConfig(argv: string[], io: Io): number {
  return runKeyed(CONFIG, argv, io);
}

export function configKeysHelp(io: Io, root: string): string {
  return keysHelp(CONFIG, loadKeys(io, root));
}
