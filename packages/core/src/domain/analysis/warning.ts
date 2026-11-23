export interface Warning {
  readonly kind: "cycle";
  readonly principle: "levelization";
  readonly fixPattern: "break-cycle";
  readonly summary: string;
  readonly files: readonly string[];
  readonly dependencies: readonly {
    readonly from: string;
    readonly to: string;
  }[];
}
