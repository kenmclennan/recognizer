export type PolicyRule =
  | {
      readonly type: "forbid";
      readonly pattern: string;
      readonly from: readonly string[];
      readonly to: readonly string[];
    }
  | { readonly type: "ignore"; readonly glob: string }
  | { readonly type: "entry"; readonly glob: string };

export type ViolatedRule =
  | { readonly type: "forbid"; readonly pattern: string }
  | {
      readonly type: "level";
      readonly fromLevel: string;
      readonly toLevel: string;
    }
  | {
      readonly type: "uses";
      readonly fromComponent: string;
      readonly toComponent: string;
    };
