export interface Diagnosis {
  readonly code: string;
  readonly line: string;
  readonly suite?: string;
  readonly fix?: string;
  readonly failing?: {
    readonly count?: number;
    readonly names: readonly string[];
  };
  readonly unmeasured?: boolean;
}
