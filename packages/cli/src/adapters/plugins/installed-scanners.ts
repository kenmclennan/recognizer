import { isAbsolute } from "node:path";
import { type Discovery, discoverPlugins } from "@recognizer/core";
import type { Io } from "../../cli.js";
import { manifestPorts } from "../../manifest-ports.js";

const held = new WeakMap<Io, { key: string; discovery: Discovery }>();

const MISSING_STAMP = "0:0";

export function installedScanners(io: Io): Discovery {
  const ports = manifestPorts(io);
  const registered = ports.registrations
    .entries()
    .plugins.filter((entry) => entry.kind === "scanner");
  const stamps = registered.map((entry) =>
    isAbsolute(entry.command[0] ?? "")
      ? io.stamp(entry.command[0] as string)
      : "",
  );
  const key = JSON.stringify(
    registered.map((entry, index) => [
      entry.name,
      entry.command,
      entry.manifest,
      entry.source,
      stamps[index],
    ]),
  );
  const current = held.get(io);

  if (registered.length > 0 && current?.key === key) {
    return current.discovery;
  }

  const discovery = discoverPlugins(ports, ["scanner"]);
  const cacheable =
    registered.length > 0 &&
    discovery.unreadable.length === 0 &&
    !stamps.includes(MISSING_STAMP);

  if (cacheable) {
    held.set(io, { key, discovery });
  } else {
    held.delete(io);
  }

  return discovery;
}
