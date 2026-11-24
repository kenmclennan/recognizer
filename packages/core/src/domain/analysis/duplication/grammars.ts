export type Grammar = string;

export interface FunctionNameRule {
  type: string;
  requires_field?: string;
  requires_field_type?: string;
  name_field?: string;
  literal?: string;
  prefix?: string;
}

export interface SpanRule {
  scope_calls: readonly string[];
  statements_type: string;
  call_type: string;
  callee_name_type: string;
  navigation_type: string;
  navigation_suffix_type: string;
  call_suffix_type: string;
  lambda_argument_type: string;
  lambda_type: string;
  jump_type: string;
  jump_returns: readonly string[];
  label_type: string;
  function_body_type: string;
  object_literal_type: string;
  object_body_type: string;
}

export interface SpanVocabulary {
  scopeCalls: ReadonlySet<string>;
  statements: string;
  call: string;
  calleeName: string;
  navigation: string;
  navigationSuffix: string;
  callSuffix: string;
  lambdaArgument: string;
  lambda: string;
  jump: string;
  jumpReturns: readonly string[];
  label: string;
  functionBody: string;
  objectLiteral: string;
  objectBody: string;
}

export function spanVocabularyOf(span: SpanRule): SpanVocabulary {
  return {
    scopeCalls: new Set(span.scope_calls),
    statements: span.statements_type,
    call: span.call_type,
    calleeName: span.callee_name_type,
    navigation: span.navigation_type,
    navigationSuffix: span.navigation_suffix_type,
    callSuffix: span.call_suffix_type,
    lambdaArgument: span.lambda_argument_type,
    lambda: span.lambda_type,
    jump: span.jump_type,
    jumpReturns: span.jump_returns,
    label: span.label_type,
    functionBody: span.function_body_type,
    objectLiteral: span.object_literal_type,
    objectBody: span.object_body_type,
  };
}

export interface GrammarRule {
  name: Grammar;
  extensions: readonly string[];
  function_types: readonly string[];
  scope_types: readonly string[];
  branch_types: readonly string[];
  boolean_operators: readonly string[];
  bound_function_types: readonly string[];
  function_names: readonly FunctionNameRule[];
  span: SpanRule | null;
}

export function grammarFor(
  path: string,
  rules: readonly GrammarRule[],
): GrammarRule | null {
  const dot = path.lastIndexOf(".");

  if (dot === -1) {
    return null;
  }

  const extension = path.slice(dot).toLowerCase();

  return rules.find((rule) => rule.extensions.includes(extension)) ?? null;
}
