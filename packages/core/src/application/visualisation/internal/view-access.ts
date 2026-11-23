import { InvalidRequest } from "../../../domain/invalid-request.js";
import { RequestRefused } from "../../../domain/request-refused.js";
import type { View, ViewChange } from "../../../domain/visualisation/view.js";
import { ViewRange } from "../../../domain/visualisation/view-range.js";
import type { VisualisationPorts } from "./visualisation-ports.js";

const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function checkName(name: string | undefined): string {
  if (name === undefined || !NAME.test(name)) {
    throw new InvalidRequest([
      `invalid view name: ${name ?? ""} (letters, digits, - and _, starting with a letter or digit, at most 64)`,
    ]);
  }

  return name;
}

export function readView(
  ports: VisualisationPorts,
  root: string,
  name: string,
): View {
  if (!ports.views.exists(root, name)) {
    throw new InvalidRequest([`no such view: ${name}`]);
  }

  return readExisting(ports, root, name);
}

export function readExisting(
  ports: VisualisationPorts,
  root: string,
  name: string,
): View {
  const read = ports.views.read(root, name);

  if (!read.ok) {
    throw new InvalidRequest(read.messages);
  }

  return read.view;
}

export function folderPath(path: string): string {
  return path.replace(/\/+$/, "");
}

export function parseChangeFlag(
  ports: VisualisationPorts,
  root: string,
  text: string,
): ViewChange {
  const change = ViewRange.parse(text);

  if (change === null) {
    throw new InvalidRequest([
      `invalid range: ${text} (expected <base>..<head>, each a git ref)`,
    ]);
  }

  for (const ref of [change.base, change.head]) {
    if (ports.git.resolveRef(root, ref) === null) {
      throw new RequestRefused([`unknown ref: ${ref}`]);
    }
  }

  return change;
}
