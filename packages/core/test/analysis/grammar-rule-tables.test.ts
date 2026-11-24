import { describe, expect, it } from "vitest";
import {
  comparedSpan,
  cyclomaticComplexity,
  findFunctions,
  type GrammarRule,
  type SpanRule,
  type SyntaxNode,
} from "../../src/index.js";

interface Spec {
  type: string;
  name?: string;
  operator?: string;
  children?: Spec[];
  fields?: Record<string, Spec>;
}

let counter = 0;

function build(spec: Spec, parent: SyntaxNode | null = null): SyntaxNode {
  counter += 1;

  const children: SyntaxNode[] = [];
  const fieldNodes = new Map<string, SyntaxNode>();
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
      const named = fieldNodes.get(field);

      if (named !== undefined) {
        return named;
      }

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

  for (const [field, fieldSpec] of Object.entries(spec.fields ?? {})) {
    fieldNodes.set(field, build(fieldSpec, node));
  }

  (node as { firstChild: SyntaxNode | null }).firstChild = children[0] ?? null;
  (node as { childCount: number }).childCount = children.length;
  (node as { namedChildCount: number }).namedChildCount = children.length;

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

const TOY_FIELDS = { name: "name", operator: "operator", body: "body" };

const TOY: GrammarRule = {
  name: "toy",
  extensions: [".toy"],
  function_types: ["toy_fn"],
  scope_types: ["toy_class"],
  branch_types: ["toy_when"],
  boolean_operators: ["both"],
  bound_function_types: [],
  function_names: [],
  span: null,
  vocabulary: { fields: TOY_FIELDS },
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

    const operators = {
      ...TOY,
      vocabulary: {
        operator_node_types: ["binary_expression"],
        fields: TOY_FIELDS,
      },
    };

    expect(cyclomaticComplexity(body, operators, new Set())).toBe(4);
    expect(
      cyclomaticComplexity(
        body,
        { ...operators, boolean_operators: [] },
        new Set(),
      ),
    ).toBe(3);
  });
});

describe("function naming rules", () => {
  const named = (rule: GrammarRule["function_names"][number], spec: Spec) =>
    findFunctions(build({ type: "toy_file", children: [spec] }), {
      ...TOY,
      function_names: [rule],
    }).map((one) => one.qualified);

  it("a function type with no naming rule keeps the shared name", () => {
    expect(
      named(
        { type: "other_fn", name_field: "name" },
        { type: "toy_fn", name: "plain" },
      ),
    ).toEqual(["plain"]);
  });

  it("a required field absent is not a function", () => {
    expect(
      named(
        { type: "toy_fn", requires_field: "body", name_field: "name" },
        { type: "toy_fn", name: "bodiless" },
      ),
    ).toEqual([]);
  });

  it("a required field of the wrong type is not a function", () => {
    const rule = {
      type: "toy_fn",
      requires_field: "value",
      requires_field_type: "arrow",
      name_field: "name",
    };

    expect(
      named(rule, {
        type: "toy_fn",
        name: "p",
        fields: { value: { type: "block" } },
      }),
    ).toEqual([]);
    expect(
      named(rule, {
        type: "toy_fn",
        name: "p",
        fields: { value: { type: "arrow" } },
      }),
    ).toEqual(["p"]);
  });

  it("a prefix with no name gives the bare prefix", () => {
    expect(
      named(
        { type: "toy_fn", prefix: "~", name_field: "missing" },
        { type: "toy_fn", name: "x" },
      ),
    ).toEqual(["~"]);
    expect(
      named(
        { type: "toy_fn", prefix: "~", name_field: "name" },
        { type: "toy_fn", name: "x" },
      ),
    ).toEqual(["~x"]);
  });

  it("a literal beats the name field", () => {
    expect(
      named(
        { type: "toy_fn", literal: "this", name_field: "name" },
        { type: "toy_fn", name: "x" },
      ),
    ).toEqual(["this"]);
  });
});

const TOY_SPAN: SpanRule = {
  scope_calls: ["wrapper"],
  statements_type: "stmts",
  call_type: "call",
  callee_name_type: "callee",
  navigation_type: "nav",
  navigation_suffix_type: "nav_suffix",
  call_suffix_type: "call_suffix",
  lambda_argument_type: "lambda_arg",
  lambda_type: "lambda",
  jump_type: "jump",
  jump_returns: ["return"],
  label_type: "label",
  function_body_type: "fn_body",
  object_literal_type: "object",
  object_body_type: "object_body",
};

function statements(...inner: Spec[]): Spec {
  return { type: "stmts", children: inner };
}

function wrapped(inner: Spec): Spec {
  return {
    type: "call",
    children: [
      { type: "callee", name: "wrapper" },
      {
        type: "call_suffix",
        children: [
          {
            type: "lambda_arg",
            children: [{ type: "lambda", children: [inner] }],
          },
        ],
      },
    ],
  };
}

function withBody(body: Spec): SyntaxNode {
  return build({
    type: "toy_fn",
    name: "f",
    fields: { body: { type: "fn_body", children: [body] } },
  });
}

describe("span rules", () => {
  it("a grammar with no span compares its body", () => {
    const fn = withBody(statements({ type: "a" }));
    const span = comparedSpan(fn, TOY);

    expect(span?.node).toBe(fn.childForFieldName("body"));
  });

  it("a span rule unwraps a sole scope call once and stops", () => {
    const inner = statements({ type: "a" }, { type: "b" });
    const fn = withBody(statements(wrapped(inner)));
    const span = comparedSpan(fn, { ...TOY, span: TOY_SPAN });

    expect(span?.node.type).toBe("stmts");
    expect(span?.node.children.map((one) => one.type)).toEqual(["a", "b"]);
  });

  it("nested scope calls unwrap to the inner statements", () => {
    const inner = statements({ type: "a" });
    const fn = withBody(statements(wrapped(statements(wrapped(inner)))));
    const span = comparedSpan(fn, { ...TOY, span: TOY_SPAN });

    expect(span?.node.children.map((one) => one.type)).toEqual(["a"]);
  });
});
