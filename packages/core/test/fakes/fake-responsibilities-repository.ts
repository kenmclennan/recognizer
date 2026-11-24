import {
  InvalidRequest,
  Responsibilities,
  type ResponsibilitiesRepository,
  type Responsibility,
} from "../../src/index.js";

function copyOf(source: Responsibilities): Responsibilities {
  const copy = new Responsibilities();

  for (const id of source.ids()) {
    copy.set(id, source.get(id) as Responsibility);
  }

  return copy;
}

export class FakeResponsibilitiesRepository
  implements ResponsibilitiesRepository
{
  readonly stored = new Map<string, Responsibilities>();
  readonly invalid = new Map<string, string>();
  writes = 0;

  read(root: string): Responsibilities {
    const reason = this.invalid.get(root);

    if (reason !== undefined) {
      throw new InvalidRequest([reason]);
    }

    const held = this.stored.get(root);

    return held === undefined ? new Responsibilities() : copyOf(held);
  }

  write(root: string, responsibilities: Responsibilities): void {
    this.writes += 1;
    this.stored.set(root, copyOf(responsibilities));
  }
}
