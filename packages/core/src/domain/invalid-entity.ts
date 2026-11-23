export interface Breach {
  readonly rule: string;
  readonly value: unknown;
}

function describe(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

export class InvalidEntity extends Error {
  readonly entity: string;
  readonly rule: string;
  readonly value: unknown;

  constructor(
    entity: string,
    rule: string,
    value: unknown,
    shown: string = describe(value),
  ) {
    super(`${entity}: ${rule}: ${shown}`);
    this.name = "InvalidEntity";
    this.entity = entity;
    this.rule = rule;
    this.value = value;
  }

  static of(entity: string, breaches: readonly Breach[]): InvalidEntity {
    return new InvalidEntity(
      entity,
      breaches.map(({ rule }) => rule).join("; "),
      breaches.map(({ value }) => value),
      breaches.map(({ value }) => describe(value)).join("; "),
    );
  }
}
