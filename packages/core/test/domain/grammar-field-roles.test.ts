import { describe, expect, it } from "vitest";
import {
  bodyOf,
  cyclomaticComplexity,
  type FieldRoles,
  findFunctions,
  type GrammarRule,
  isTrivialShape,
  normalise,
  type SyntaxNode,
  type VocabularyRule,
  vocabularyOf,
} from "../../src/index.js";

interface Spec {
  type: string;
  text?: string;
  children?: Spec[];
  fields?: Record<string, number>;
}

let counter = 0;

function build(spec: Spec, parent: SyntaxNode | null = null): SyntaxNode {
  counter += 1;

  const children: SyntaxNode[] = [];
  const node: SyntaxNode = {
    id: counter,
    type: spec.type,
    text: spec.text ?? spec.type,
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
      const index = spec.fields?.[field];

      return index === undefined ? null : (children[index] ?? null);
    },
  };

  for (const child of spec.children ?? []) {
    children.push(build(child, node));
  }

  (node as { firstChild: SyntaxNode | null }).firstChild = children[0] ?? null;
  (node as { childCount: number }).childCount = children.length;
  (node as { namedChildCount: number }).namedChildCount = children.length;

  return node;
}

const TOY_FIELDS: Required<FieldRoles> = {
  name: "label",
  body: "inner",
  expression_body: "expr",
  parameters: "params",
  parameter_pattern: "pat",
  arguments: "argl",
  callee: "target",
  operator: "oper",
  assigned_value: "rhs",
  bound_value: "val",
  initialiser_list: "items",
  initialiser_value: "ival",
};

type Role = keyof FieldRoles;

const ROLES = Object.keys(TOY_FIELDS) as Role[];

const BASE: VocabularyRule = {
  identifier_types: ["ident"],
  block_types: ["blk"],
  return_types: ["give"],
  assignment_types: ["set"],
  member_types: ["dot"],
  self_types: ["me"],
  shorthand_initialiser_types: ["short"],
  field_initialiser_types: ["fld"],
  struct_literal_types: ["rec"],
  plain_name_types: ["ident"],
  call_types: ["invoke"],
  expression_bodied_types: ["prop_fn"],
  expression_body_types: ["arrow"],
  binding_declarator_types: ["declarator"],
  binding_name_types: ["ident"],
  operator_node_types: ["binary"],
  assignment_operators: ["="],
};

const TOY: GrammarRule = {
  name: "toy",
  extensions: [".toy"],
  function_types: ["fn"],
  scope_types: [],
  branch_types: [],
  boolean_operators: ["both"],
  bound_function_types: ["arrow_fn"],
  function_names: [],
  span: null,
  vocabulary: null,
};

function ruleWith(roles: FieldRoles, extra: VocabularyRule = {}): GrammarRule {
  return {
    ...TOY,
    vocabulary: { ...BASE, ...extra, fields: roles },
  };
}

function without(role: Role): FieldRoles {
  const { [role]: _removed, ...rest } = TOY_FIELDS;

  return rest;
}

const ident = (text: string): Spec => ({ type: "ident", text });

function fnWith(statements: Spec[], parameters: Spec[] = []): SyntaxNode {
  return build({
    type: "fn",
    fields: { inner: 0, params: 1 },
    children: [
      { type: "blk", children: statements },
      { type: "plist", children: parameters },
    ],
  });
}

const selfDot = (field: string): Spec => ({
  type: "dot",
  children: [{ type: "me" }, ident(field)],
});

const store = (value: Spec, fields: Record<string, number>): Spec => ({
  type: "set",
  children: [ident("lhs"), value],
  fields,
});

function names(spec: Spec, rule: GrammarRule): string[] {
  return findFunctions(build({ type: "file", children: [spec] }), rule).map(
    (one) => one.qualified,
  );
}

interface RoleCase {
  published: () => unknown;
  absent: () => unknown;
  readonly expected: [unknown, unknown];
}

function shapeCase(
  role: Role,
  build: (roles: FieldRoles) => boolean,
  expected: [boolean, boolean],
): [Role, RoleCase] {
  return [
    role,
    {
      published: () => build(TOY_FIELDS),
      absent: () => build(without(role)),
      expected,
    },
  ];
}

const declarator: Spec = {
  type: "declarator",
  fields: { label: 0, val: 1 },
  children: [ident("bound"), { type: "arrow_fn" }],
};

const fnWithName: Spec = {
  type: "fn",
  fields: { label: 0 },
  children: [ident("run")],
};

const CASES: [Role, RoleCase][] = [
  [
    "name",
    {
      published: () => names(fnWithName, ruleWith(TOY_FIELDS)),
      absent: () => names(fnWithName, ruleWith(without("name"))),
      expected: [["run"], []],
    },
  ],
  [
    "body",
    {
      published: () =>
        bodyOf(
          build({
            type: "fn",
            fields: { inner: 0 },
            children: [{ type: "xx" }],
          }),
          vocabularyOf(ruleWith(TOY_FIELDS)),
        )?.type ?? null,
      absent: () =>
        bodyOf(
          build({
            type: "fn",
            fields: { inner: 0 },
            children: [{ type: "xx" }],
          }),
          vocabularyOf(ruleWith(without("body"))),
        )?.type ?? null,
      expected: ["xx", null],
    },
  ],
  [
    "expression_body",
    {
      published: () =>
        bodyOf(
          build({
            type: "prop_fn",
            fields: { expr: 0 },
            children: [{ type: "arrow" }],
          }),
          vocabularyOf(ruleWith(TOY_FIELDS)),
        )?.type ?? null,
      absent: () =>
        bodyOf(
          build({
            type: "prop_fn",
            fields: { expr: 0 },
            children: [{ type: "arrow" }],
          }),
          vocabularyOf(ruleWith(without("expression_body"))),
        )?.type ?? null,
      expected: ["arrow", null],
    },
  ],
  shapeCase(
    "parameters",
    (roles) =>
      isTrivialShape(
        fnWith([store(ident("a"), { rhs: 1 })], [ident("a")]),
        vocabularyOf(ruleWith(roles)),
      ),
    [true, false],
  ),
  shapeCase(
    "parameter_pattern",
    (roles) =>
      isTrivialShape(
        fnWith(
          [store(ident("a"), { rhs: 1 })],
          [
            {
              type: "param",
              fields: { pat: 1 },
              children: [ident("decoy"), ident("a")],
            },
          ],
        ),
        vocabularyOf(ruleWith(roles)),
      ),
    [true, false],
  ),
  shapeCase(
    "arguments",
    (roles) =>
      isTrivialShape(
        fnWith([
          {
            type: "give",
            children: [
              {
                type: "invoke",
                fields: { argl: 1 },
                children: [
                  selfDot("a"),
                  { type: "list", children: [ident("k")] },
                ],
              },
            ],
          },
        ]),
        vocabularyOf(ruleWith(roles)),
      ),
    [false, true],
  ),
  shapeCase(
    "callee",
    (roles) =>
      isTrivialShape(
        fnWith([
          {
            type: "give",
            children: [
              {
                type: "invoke",
                fields: { target: 1 },
                children: [{ type: "zz" }, selfDot("a")],
              },
            ],
          },
        ]),
        vocabularyOf(ruleWith(roles)),
      ),
    [true, false],
  ),
  [
    "operator",
    {
      published: () =>
        cyclomaticComplexity(
          build({
            type: "fn",
            children: [
              {
                type: "binary",
                fields: { oper: 1 },
                children: [ident("x"), { type: "both" }],
              },
            ],
          }),
          ruleWith(TOY_FIELDS),
          new Set(),
        ),
      absent: () =>
        cyclomaticComplexity(
          build({
            type: "fn",
            children: [
              {
                type: "binary",
                fields: { oper: 1 },
                children: [ident("x"), { type: "both" }],
              },
            ],
          }),
          ruleWith(without("operator")),
          new Set(),
        ),
      expected: [2, 1],
    },
  ],
  shapeCase(
    "assigned_value",
    (roles) =>
      isTrivialShape(
        fnWith([store(ident("a"), { rhs: 1 })], [ident("a")]),
        vocabularyOf(ruleWith(roles)),
      ),
    [true, false],
  ),
  [
    "bound_value",
    {
      published: () => names(declarator, ruleWith(TOY_FIELDS)),
      absent: () => names(declarator, ruleWith(without("bound_value"))),
      expected: [["bound"], []],
    },
  ],
  shapeCase(
    "initialiser_list",
    (roles) =>
      isTrivialShape(
        fnWith(
          [
            {
              type: "rec",
              fields: { items: 0 },
              children: [
                { type: "inits", children: [{ type: "short", text: "a" }] },
              ],
            },
          ],
          [ident("a")],
        ),
        vocabularyOf(ruleWith(roles)),
      ),
    [true, false],
  ),
  shapeCase(
    "initialiser_value",
    (roles) =>
      isTrivialShape(
        fnWith(
          [
            {
              type: "rec",
              fields: { items: 0 },
              children: [
                {
                  type: "inits",
                  children: [
                    {
                      type: "fld",
                      fields: { ival: 1 },
                      children: [ident("x"), ident("a")],
                    },
                  ],
                },
              ],
            },
          ],
          [ident("a")],
        ),
        vocabularyOf(ruleWith(roles)),
      ),
    [true, false],
  ),
];

describe("field roles", () => {
  it("covers all twelve roles", () => {
    expect(CASES.map(([role]) => role).sort()).toEqual([...ROLES].sort());
  });

  it.each(CASES)("a published %s role is read", (_role, one) => {
    expect(one.published()).toEqual(one.expected[0]);
  });

  it.each(CASES)("an absent %s role is not read", (_role, one) => {
    expect(one.absent()).toEqual(one.expected[1]);
  });

  it("a callee role steers normalisation to the named callee", () => {
    const call: Spec = {
      type: "invoke",
      fields: { target: 1 },
      children: [ident("first"), ident("second")],
    };
    const text = (roles: FieldRoles) =>
      JSON.stringify(
        normalise(build(call), new Set(), vocabularyOf(ruleWith(roles))),
      );

    expect(text(TOY_FIELDS)).toContain("second");
    expect(text(TOY_FIELDS)).not.toContain("first");
    expect(text(without("callee"))).toContain("first");
  });

  it("a vocabulary publishing some roles reads each by its own", () => {
    const rule = ruleWith({ name: "label" });
    const both: Spec = {
      type: "file",
      children: [fnWithName, declarator],
    };

    expect(
      findFunctions(build(both), rule).map((one) => one.qualified),
    ).toEqual(["run"]);
  });
});

describe("assignment operators", () => {
  const assign = (operator: string, fields: Record<string, number>): Spec => ({
    type: "set",
    fields,
    children: [ident("lhs"), { type: "op", text: operator }, ident("a")],
  });
  const stores = (statement: Spec, operators: string[]) =>
    isTrivialShape(
      fnWith([statement], [ident("a")]),
      vocabularyOf(
        ruleWith(TOY_FIELDS, {
          assignment_operators: operators,
          positional_assignment_types: ["set"],
        }),
      ),
    );

  it("an assignment operator in the list is a store", () => {
    expect(stores(assign("=", { oper: 1, rhs: 2 }), ["="])).toBe(true);
    expect(stores(assign(":=", { oper: 1, rhs: 2 }), [":="])).toBe(true);
    expect(stores(assign("=", {}), ["="])).toBe(true);
  });

  it("one outside the list is not", () => {
    expect(stores(assign("+=", { oper: 1, rhs: 2 }), ["="])).toBe(false);
    expect(stores(assign("+=", {}), ["="])).toBe(false);
  });

  it("an empty list makes nothing a store", () => {
    expect(stores(assign("=", { oper: 1, rhs: 2 }), [])).toBe(false);
    expect(stores(assign("=", {}), [])).toBe(false);
  });
});

describe("vocabularyOf", () => {
  it("compiles absent roles to null and operators to an empty set", () => {
    const empty = vocabularyOf({ ...TOY, vocabulary: {} });

    expect(Object.keys(empty.fields).sort()).toEqual([...ROLES].sort());
    expect(Object.values(empty.fields).every((value) => value === null)).toBe(
      true,
    );
    expect(empty.assignmentOperators.size).toBe(0);
  });

  it("carries the published roles and operators", () => {
    const compiled = vocabularyOf(ruleWith(TOY_FIELDS));

    expect(compiled.fields).toEqual(TOY_FIELDS);
    expect([...compiled.assignmentOperators]).toEqual(["="]);
  });
});
