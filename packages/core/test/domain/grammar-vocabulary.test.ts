import { describe, expect, it } from "vitest";
import {
  bodyOf,
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

const TOY_VOCABULARY: VocabularyRule = {
  comment_markers: ["note"],
  literal_types: ["str"],
  literal_suffixes: ["_lit"],
  call_types: ["invoke"],
  identifier_types: ["ident"],
  identifier_suffixes: ["_id"],
  member_fields: [{ type: "dot", field: "prop" }, { type: "chain" }],
  block_types: ["blk"],
  return_types: ["give"],
  jump_types: ["jmp"],
  return_keywords: ["give"],
  assignment_types: ["set", "pset"],
  positional_assignment_types: ["pset"],
  member_types: ["dot"],
  subscript_types: ["idx"],
  identifier_leaf_types: ["ident"],
  self_types: ["me"],
  self_texts: ["myself"],
  shorthand_initialiser_types: ["short"],
  field_initialiser_types: ["fld"],
  struct_literal_types: ["rec"],
  plain_name_types: ["ident"],
  expression_statement_types: ["stmt"],
  docstring_string_types: ["str"],
  argument_list_types: ["args"],
  expression_bodied_types: ["prop_fn"],
  expression_body_types: ["arrow"],
  name_leaf_types: ["ident"],
  fields: {
    name: "name",
    body: "body",
    expression_body: "value",
    parameters: "parameters",
    parameter_pattern: "pattern",
    arguments: "arguments",
    callee: "function",
    operator: "operator",
    assigned_value: "right",
    bound_value: "value",
    initialiser_list: "body",
    initialiser_value: "value",
  },
  assignment_operators: ["="],
  node_names: [
    { type: "impl", name_field: "target", strip_after: "<" },
    { type: "comp", default: "Companion" },
    { type: "indexer", literal: "this" },
  ],
};

const TOY: GrammarRule = {
  name: "toy",
  extensions: [".toy"],
  function_types: ["fn", "prop_fn"],
  scope_types: ["impl", "comp", "indexer", "cls"],
  branch_types: [],
  boolean_operators: [],
  bound_function_types: [],
  function_names: [],
  span: null,
  vocabulary: TOY_VOCABULARY,
};

function vocabulary(extra: VocabularyRule = {}) {
  return vocabularyOf({
    ...TOY,
    vocabulary: { ...TOY_VOCABULARY, ...extra },
  });
}

const ident = (text: string): Spec => ({ type: "ident", text });

function normalised(spec: Spec, extra: VocabularyRule = {}) {
  return normalise(build(spec), new Set(), vocabulary(extra));
}

function qualified(scope: Spec, rule: GrammarRule = TOY): string[] {
  return findFunctions(build({ type: "file", children: [scope] }), rule).map(
    (one) => one.qualified,
  );
}

describe("vocabularyOf", () => {
  it("memoises on the rule object", () => {
    const rule = { ...TOY };

    expect(vocabularyOf(rule)).toBe(vocabularyOf(rule));
  });

  it("compiles absent roles to empty sets", () => {
    const empty = vocabularyOf({ ...TOY, vocabulary: null });

    expect(empty.literalTypes.size).toBe(0);
    expect(empty.commentMarkers).toEqual([]);
    expect(empty.nodeNames.size).toBe(0);
  });
});

describe("normalise reads the vocabulary", () => {
  it("a marker drops a comment", () => {
    expect(
      normalised({
        type: "fn",
        children: [{ type: "a_note" }, { type: "keep" }],
      }),
    ).toEqual(["fn", [["keep", []]]]);
  });

  it("a listed literal type gives the literal token", () => {
    expect(normalised({ type: "fn", children: [{ type: "str" }] })).toEqual([
      "fn",
      [["LIT", []]],
    ]);
  });

  it("a literal suffix gives the literal token", () => {
    expect(
      normalised({ type: "fn", children: [{ type: "number_lit" }] }),
    ).toEqual(["fn", [["LIT", []]]]);
  });

  it("an identifier suffix blanks a leaf", () => {
    expect(
      normalised({ type: "fn", children: [{ type: "name_id", text: "x" }] }),
    ).toEqual(["fn", [["ID", []]]]);
  });

  it("an identifier by listed type is blanked and one with children is not", () => {
    expect(
      normalised({
        type: "fn",
        children: [ident("x"), { type: "ident", children: [{ type: "k" }] }],
      }),
    ).toEqual([
      "fn",
      [
        ["ID", []],
        ["ident", [["k", []]]],
      ],
    ]);
  });

  it("a member field names the callee's final name", () => {
    const call: Spec = {
      type: "invoke",
      children: [
        {
          type: "dot",
          fields: { prop: 1 },
          children: [ident("recv"), ident("go")],
        },
      ],
    };

    expect(normalised(call)).toEqual([
      "invoke",
      [
        [
          "dot",
          [
            ["ID", []],
            ["go", []],
          ],
        ],
      ],
    ]);
  });

  it("a member field with no field takes the last named child", () => {
    const call: Spec = {
      type: "invoke",
      children: [{ type: "chain", children: [ident("recv"), ident("last")] }],
    };

    expect(normalised(call)).toEqual([
      "invoke",
      [
        [
          "chain",
          [
            ["ID", []],
            ["last", []],
          ],
        ],
      ],
    ]);
  });

  it("no vocabulary recognises nothing", () => {
    const spec: Spec = {
      type: "fn",
      children: [{ type: "a_note" }, { type: "str" }, ident("x")],
    };

    expect(
      normalise(
        build(spec),
        new Set(),
        vocabularyOf({ ...TOY, vocabulary: null }),
      ),
    ).toEqual([
      "fn",
      [
        ["a_note", []],
        ["str", []],
        ["ident", []],
      ],
    ]);
  });
});

describe("naming reads the vocabulary", () => {
  const run: Spec = {
    type: "fn",
    fields: { name: 0 },
    children: [ident("run")],
  };

  it("a name field wins over a node name rule", () => {
    expect(
      qualified({
        type: "indexer",
        fields: { name: 0 },
        children: [ident("Named"), run],
      }),
    ).toEqual(["Named.run"]);
  });

  it("a node name rule with strip_after cuts at the first marker", () => {
    expect(
      qualified({
        type: "impl",
        fields: { target: 0 },
        children: [{ type: "path", text: "Box<T<U>>" }, run],
      }),
    ).toEqual(["Box.run"]);
  });

  it("a node name rule with a missing field gives no name", () => {
    expect(qualified({ type: "impl", children: [ident("Leaf"), run] })).toEqual(
      ["run"],
    );
  });

  it("a literal wins over a name leaf", () => {
    expect(
      qualified({ type: "indexer", children: [ident("Leaf"), run] }),
    ).toEqual(["this.run"]);
  });

  it("a default is used only without a name leaf", () => {
    expect(qualified({ type: "comp", children: [run] })).toEqual([
      "Companion.run",
    ]);
    expect(
      qualified({ type: "comp", children: [ident("Named"), run] }),
    ).toEqual(["Named.run"]);
  });

  it("a type with no rule uses the first name leaf", () => {
    expect(qualified({ type: "cls", children: [ident("Plain"), run] })).toEqual(
      ["Plain.run"],
    );
  });

  it("no vocabulary names nothing", () => {
    expect(
      qualified(
        { type: "cls", children: [ident("Plain"), run] },
        { ...TOY, vocabulary: null },
      ),
    ).toEqual([]);
    expect(
      qualified(
        { type: "fn", children: [ident("leaf")] },
        { ...TOY, vocabulary: null },
      ),
    ).toEqual([]);
  });

  it("a bound function is named by its declarator and name types", () => {
    const rule: GrammarRule = {
      ...TOY,
      bound_function_types: ["arrow_fn"],
      vocabulary: {
        ...TOY_VOCABULARY,
        binding_declarator_types: ["declarator"],
        binding_name_types: ["ident"],
      },
    };
    const declarator: Spec = {
      type: "declarator",
      fields: { name: 0, value: 1 },
      children: [ident("bound"), { type: "arrow_fn" }],
    };

    expect(qualified(declarator, rule)).toEqual(["bound"]);
    expect(
      qualified(declarator, {
        ...rule,
        vocabulary: { ...rule.vocabulary, binding_name_types: [] },
      }),
    ).toEqual([]);
  });
});

function fnWith(
  statements: Spec[],
  parameters: string[] = [],
  bodyType = "blk",
): SyntaxNode {
  return build({
    type: "fn",
    fields: { body: 0, parameters: 1 },
    children: [
      { type: bodyType, children: statements },
      { type: "plist", children: parameters.map(ident) },
    ],
  });
}

const selfDot = (field: string): Spec => ({
  type: "dot",
  children: [{ type: "me" }, ident(field)],
});

describe("shapes read the vocabulary", () => {
  it("an accessor goes through member types, subscript types and calls with atom arguments", () => {
    const shape = (expression: Spec) =>
      isTrivialShape(
        fnWith([{ type: "give", children: [expression] }]),
        vocabulary(),
      );

    expect(shape(selfDot("a"))).toBe(true);
    expect(
      shape({
        type: "idx",
        children: [selfDot("a"), { type: "str" }],
      }),
    ).toBe(true);
    expect(
      shape({
        type: "idx",
        children: [selfDot("a"), ident("k")],
      }),
    ).toBe(false);
    expect(
      shape({
        type: "invoke",
        children: [selfDot("a"), { type: "args", children: [{ type: "str" }] }],
      }),
    ).toBe(true);
    expect(
      shape({
        type: "invoke",
        children: [selfDot("a"), { type: "args", children: [ident("k")] }],
      }),
    ).toBe(false);
  });

  it("a return keyword makes a jump an accessor", () => {
    expect(
      isTrivialShape(
        fnWith([{ type: "jmp", text: "give it", children: [selfDot("a")] }]),
        vocabulary(),
      ),
    ).toBe(true);
  });

  it("a jump that is not a return is not an accessor", () => {
    expect(
      isTrivialShape(
        fnWith([{ type: "jmp", text: "stop it", children: [selfDot("a")] }]),
        vocabulary(),
      ),
    ).toBe(false);
  });

  it("a constructor stores parameters through assignment types", () => {
    const assign = (type: string, operator: string, right: Spec): Spec => ({
      type,
      children: [ident("lhs"), { type: "op", text: operator }, right],
      fields: type === "set" ? { right: 2 } : {},
    });
    const shape = (statement: Spec) =>
      isTrivialShape(fnWith([statement], ["a"]), vocabulary());

    expect(shape(assign("set", "=", ident("a")))).toBe(true);
    expect(shape(assign("set", "=", ident("other")))).toBe(false);
    expect(shape(assign("set", "=", { type: "str" }))).toBe(true);
    expect(shape(assign("pset", "=", ident("a")))).toBe(true);
  });

  it("a positional assignment with another operator is not a constructor", () => {
    const positional = (operator: string): Spec => ({
      type: "pset",
      children: [ident("lhs"), { type: "op", text: operator }, ident("a")],
    });

    expect(isTrivialShape(fnWith([positional("=")], ["a"]), vocabulary())).toBe(
      true,
    );
    expect(
      isTrivialShape(fnWith([positional("+=")], ["a"]), vocabulary()),
    ).toBe(false);
  });

  it("a struct literal built from parameter shorthands is a constructor", () => {
    const literal = (initialisers: Spec[]): Spec => ({
      type: "rec",
      fields: { body: 0 },
      children: [{ type: "inits", children: initialisers }],
    });

    expect(
      isTrivialShape(
        fnWith([literal([{ type: "short", text: "a" }])], ["a"]),
        vocabulary(),
      ),
    ).toBe(true);
    expect(
      isTrivialShape(
        fnWith([literal([{ type: "short", text: "b" }])], ["a"]),
        vocabulary(),
      ),
    ).toBe(false);
    expect(
      isTrivialShape(
        fnWith([literal([{ type: "other", text: "a" }])], ["a"]),
        vocabulary(),
      ),
    ).toBe(false);
  });

  it("a docstring is skipped only after a block type matched", () => {
    const docstring: Spec = { type: "stmt", children: [{ type: "str" }] };
    const store: Spec = {
      type: "set",
      fields: { right: 1 },
      children: [ident("lhs"), ident("a")],
    };

    expect(
      isTrivialShape(fnWith([docstring, store], ["a"]), vocabulary()),
    ).toBe(true);
    expect(
      isTrivialShape(fnWith([docstring, store], ["a"], "plain"), vocabulary()),
    ).toBe(false);
  });

  it("an expression-bodied member is found through expression body types", () => {
    const member = build({
      type: "prop_fn",
      fields: { value: 0 },
      children: [{ type: "arrow", children: [selfDot("a")] }],
    });

    expect(bodyOf(member, vocabulary())?.type).toBe("arrow");
    expect(isTrivialShape(member, vocabulary())).toBe(true);
    expect(
      bodyOf(member, vocabulary({ expression_body_types: [] })),
    ).toBeNull();
  });

  it("a non-leaf self type ends a lookup chain", () => {
    const shape = (head: Spec) =>
      isTrivialShape(
        fnWith([
          {
            type: "give",
            children: [{ type: "dot", children: [head, ident("a")] }],
          },
        ]),
        vocabulary(),
      );

    expect(shape({ type: "me", children: [{ type: "k" }] })).toBe(true);
    expect(shape({ type: "other", children: [{ type: "k" }] })).toBe(false);
  });

  it("a self reference by text is an atom", () => {
    expect(
      isTrivialShape(
        fnWith([
          {
            type: "give",
            children: [
              {
                type: "dot",
                children: [{ type: "zzz", text: "myself" }, ident("a")],
              },
            ],
          },
        ]),
        vocabulary(),
      ),
    ).toBe(true);
  });
});
