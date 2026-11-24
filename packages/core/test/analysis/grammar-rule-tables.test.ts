import { describe, expect, it } from "vitest";
import {
  cyclomaticComplexity,
  findFunctions,
  type GrammarRule,
  type SyntaxNode,
} from "../../src/index.js";

interface Spec {
  type: string;
  name?: string;
  operator?: string;
  children?: Spec[];
}

let counter = 0;

function build(spec: Spec, parent: SyntaxNode | null = null): SyntaxNode {
  counter += 1;

  const children: SyntaxNode[] = [];
  const node: SyntaxNode = {
    id: counter,
    type: spec.type,
    text: spec.name ?? spec.type,
    firstChild: null,
    startIndex: 0,
    endIndex: 0,
    startPosition: { row: 0 },
    endPosition: { row: 0 },
    hasError: false,
    parent,
    childCount: 0,
    namedChildCount: 0,
    children,
    namedChildren: children,
    childForFieldName(field: string) {
      if (field === "name" && spec.name !== undefined) {
        return { ...leaf(spec.name), parent: node };
      }

      if (field === "operator" && spec.operator !== undefined) {
        return { ...leaf(spec.operator, spec.operator), parent: node };
      }

      return null;
    },
  };

  for (const child of spec.children ?? []) {
    children.push(build(child, node));
  }

  return node;
}

function leaf(text: string, type = "identifier"): SyntaxNode {
  counter += 1;

  return {
    id: counter,
    type,
    text,
    firstChild: null,
    startIndex: 0,
    endIndex: 0,
    startPosition: { row: 0 },
    endPosition: { row: 0 },
    hasError: false,
    parent: null,
    childCount: 0,
    namedChildCount: 0,
    children: [],
    namedChildren: [],
    childForFieldName: () => null,
  };
}

const TOY: GrammarRule = {
  name: "toy",
  extensions: [".toy"],
  function_types: ["toy_fn"],
  scope_types: ["toy_class"],
  branch_types: ["toy_when"],
  boolean_operators: ["both"],
  bound_function_types: [],
};

describe("function finding driven by a rule", () => {
  it("finds functions and scopes by the rule's own node types", () => {
    const root = build({
      type: "toy_file",
      children: [
        {
          type: "toy_class",
          name: "Box",
          children: [{ type: "toy_fn", name: "open" }],
        },
        { type: "function_definition", name: "ignored" },
      ],
    });

    expect(findFunctions(root, TOY).map((one) => one.qualified)).toEqual([
      "Box.open",
    ]);
  });

  it("never looks up a bound name when the rule lists no bound function types", () => {
    const bound: Spec = {
      type: "toy_file",
      children: [{ type: "toy_fn", name: "named" }, { type: "arrow_function" }],
    };

    expect(
      findFunctions(build(bound), TOY).map((one) => one.qualified),
    ).toEqual(["named"]);
    expect(
      findFunctions(build(bound), {
        ...TOY,
        bound_function_types: ["arrow_function"],
      }).map((one) => one.qualified),
    ).toEqual(["named"]);
  });
});

describe("complexity driven by a rule", () => {
  it("adds one per branch type and per listed boolean operator", () => {
    const body = build({
      type: "toy_fn",
      children: [
        { type: "toy_when" },
        { type: "toy_when" },
        { type: "binary_expression", operator: "both" },
        { type: "binary_expression", operator: "other" },
      ],
    });

    expect(cyclomaticComplexity(body, TOY, new Set())).toBe(4);
    expect(
      cyclomaticComplexity(body, { ...TOY, boolean_operators: [] }, new Set()),
    ).toBe(3);
  });
});
