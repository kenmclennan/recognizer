export interface DeclaredMetric {
  name: string;
  type: "ratio" | "count" | "number" | "boolean";
  granularity: string;
  bad: "high" | "low";
}

export interface AccumulatedOverlay {
  metrics: DeclaredMetric[];
  values: Record<string, Record<string, number | boolean>>;
}
