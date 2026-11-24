import type {
  FieldRoles,
  GrammarRule,
  NodeNameRule,
  VocabularyRule,
} from "./grammars.js";

export type FieldNames = {
  readonly [R in keyof Required<FieldRoles>]: string | null;
};

export interface Vocabulary {
  readonly fields: FieldNames;
  readonly assignmentOperators: ReadonlySet<string>;
  readonly commentMarkers: readonly string[];
  readonly literalTypes: ReadonlySet<string>;
  readonly literalSuffixes: readonly string[];
  readonly callTypes: ReadonlySet<string>;
  readonly identifierTypes: ReadonlySet<string>;
  readonly identifierSuffixes: readonly string[];
  readonly memberFields: ReadonlyMap<string, string | null>;
  readonly blockTypes: ReadonlySet<string>;
  readonly returnTypes: ReadonlySet<string>;
  readonly jumpTypes: ReadonlySet<string>;
  readonly returnKeywords: readonly string[];
  readonly assignmentTypes: ReadonlySet<string>;
  readonly positionalAssignmentTypes: ReadonlySet<string>;
  readonly memberTypes: ReadonlySet<string>;
  readonly subscriptTypes: ReadonlySet<string>;
  readonly identifierLeafTypes: ReadonlySet<string>;
  readonly selfTypes: ReadonlySet<string>;
  readonly selfTexts: ReadonlySet<string>;
  readonly shorthandInitialiserTypes: ReadonlySet<string>;
  readonly fieldInitialiserTypes: ReadonlySet<string>;
  readonly structLiteralTypes: ReadonlySet<string>;
  readonly plainNameTypes: ReadonlySet<string>;
  readonly expressionStatementTypes: ReadonlySet<string>;
  readonly docstringStringTypes: ReadonlySet<string>;
  readonly argumentWrapperTypes: ReadonlySet<string>;
  readonly argumentListTypes: ReadonlySet<string>;
  readonly callSuffixTypes: ReadonlySet<string>;
  readonly subscriptArgumentListTypes: ReadonlySet<string>;
  readonly parameterListTypes: ReadonlySet<string>;
  readonly expressionBodiedTypes: ReadonlySet<string>;
  readonly expressionBodyTypes: ReadonlySet<string>;
  readonly functionBodyTypes: ReadonlySet<string>;
  readonly nameLeafTypes: ReadonlySet<string>;
  readonly bindingDeclaratorTypes: ReadonlySet<string>;
  readonly bindingNameTypes: ReadonlySet<string>;
  readonly operatorNodeTypes: ReadonlySet<string>;
  readonly nodeNames: ReadonlyMap<string, NodeNameRule>;
  readonly calleeTypes: ReadonlySet<string>;
}

function listOf(values: readonly string[] | undefined): readonly string[] {
  return values ?? [];
}

function setOf(values: readonly string[] | undefined): ReadonlySet<string> {
  return new Set(values ?? []);
}

const NO_FIELDS: FieldNames = {
  name: null,
  body: null,
  expression_body: null,
  parameters: null,
  parameter_pattern: null,
  arguments: null,
  callee: null,
  operator: null,
  assigned_value: null,
  bound_value: null,
  initialiser_list: null,
  initialiser_value: null,
};

function fieldsOf(fields: FieldRoles | undefined): FieldNames {
  const published = Object.entries(fields ?? {}).filter(
    ([, value]) => value !== undefined,
  );

  return { ...NO_FIELDS, ...Object.fromEntries(published) };
}

function compile(rule: VocabularyRule): Vocabulary {
  const memberTypes = setOf(rule.member_types);
  const subscriptTypes = setOf(rule.subscript_types);
  const plainNameTypes = setOf(rule.plain_name_types);

  return {
    fields: fieldsOf(rule.fields),
    assignmentOperators: setOf(rule.assignment_operators),
    commentMarkers: listOf(rule.comment_markers),
    literalTypes: setOf(rule.literal_types),
    literalSuffixes: listOf(rule.literal_suffixes),
    callTypes: setOf(rule.call_types),
    identifierTypes: setOf(rule.identifier_types),
    identifierSuffixes: listOf(rule.identifier_suffixes),
    memberFields: new Map(
      (rule.member_fields ?? []).map((entry) => [
        entry.type,
        entry.field ?? null,
      ]),
    ),
    blockTypes: setOf(rule.block_types),
    returnTypes: setOf(rule.return_types),
    jumpTypes: setOf(rule.jump_types),
    returnKeywords: listOf(rule.return_keywords),
    assignmentTypes: setOf(rule.assignment_types),
    positionalAssignmentTypes: setOf(rule.positional_assignment_types),
    memberTypes: setOf(rule.member_types),
    subscriptTypes: setOf(rule.subscript_types),
    identifierLeafTypes: setOf(rule.identifier_leaf_types),
    selfTypes: setOf(rule.self_types),
    selfTexts: setOf(rule.self_texts),
    shorthandInitialiserTypes: setOf(rule.shorthand_initialiser_types),
    fieldInitialiserTypes: setOf(rule.field_initialiser_types),
    structLiteralTypes: setOf(rule.struct_literal_types),
    plainNameTypes: setOf(rule.plain_name_types),
    expressionStatementTypes: setOf(rule.expression_statement_types),
    docstringStringTypes: setOf(rule.docstring_string_types),
    argumentWrapperTypes: setOf(rule.argument_wrapper_types),
    argumentListTypes: setOf(rule.argument_list_types),
    callSuffixTypes: setOf(rule.call_suffix_types),
    subscriptArgumentListTypes: setOf(rule.subscript_argument_list_types),
    parameterListTypes: setOf(rule.parameter_list_types),
    expressionBodiedTypes: setOf(rule.expression_bodied_types),
    expressionBodyTypes: setOf(rule.expression_body_types),
    functionBodyTypes: setOf(rule.function_body_types),
    nameLeafTypes: setOf(rule.name_leaf_types),
    bindingDeclaratorTypes: setOf(rule.binding_declarator_types),
    bindingNameTypes: setOf(rule.binding_name_types),
    operatorNodeTypes: setOf(rule.operator_node_types),
    nodeNames: new Map(
      (rule.node_names ?? []).map((entry) => [entry.type, entry]),
    ),
    calleeTypes: new Set([
      ...memberTypes,
      ...subscriptTypes,
      ...plainNameTypes,
    ]),
  };
}

const EMPTY: VocabularyRule = {};
const compiled = new WeakMap<object, Vocabulary>();

export function vocabularyOf(rule: GrammarRule): Vocabulary {
  const source = rule.vocabulary ?? EMPTY;
  const key = rule.vocabulary ?? rule;
  let found = compiled.get(key);

  if (found === undefined) {
    found = compile(source);
    compiled.set(key, found);
  }

  return found;
}
