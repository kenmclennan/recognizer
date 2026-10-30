import type { ScanField, ScanMember, ScanMethod } from "recognizer";

type ScanParam = NonNullable<ScanMethod["params"]>[number];
type ScanTag = NonNullable<ScanMember["tags"]>[number];

export type TokenRole =
  | "keyword"
  | "name"
  | "type"
  | "param"
  | "value"
  | "plain";

export type Token = { text: string; role: TokenRole };

const BUILT_IN = new Set([
  "string",
  "number",
  "boolean",
  "void",
  "null",
  "undefined",
  "readonly",
]);
const SHOWN_TAGS: ScanTag[] = ["static", "classmethod", "abstract", "async"];
const WORD = /([A-Za-z_$][\w$]*)/;

const token = (text: string, role: TokenRole): Token => ({ text, role });
const plain = (text: string) => token(text, "plain");
const keyword = (text: string) => token(text, "keyword");
const name = (text: string) => token(text, "name");

export function typeTokens(text: string): Token[] {
  return text
    .split(WORD)
    .filter((part) => part !== "")
    .map((part) =>
      WORD.test(part)
        ? token(part, BUILT_IN.has(part) ? "keyword" : "type")
        : plain(part),
    );
}

export function valueTokens(text: string): Token[] {
  return [token(text, BUILT_IN.has(text) ? "keyword" : "value")];
}

function paramTokens(param: ScanParam): Token[] {
  const head = token(param.name, "param");

  return param.type === undefined
    ? [head]
    : [head, plain(": "), ...typeTokens(param.type)];
}

function tagTokens(tags: readonly ScanTag[] | undefined): Token[] {
  return SHOWN_TAGS.filter((tag) => tags?.includes(tag)).flatMap((tag) => [
    plain(" "),
    keyword(tag),
  ]);
}

type Callable = {
  name: string;
  params?: ScanParam[];
  returns?: string;
  tags?: readonly ScanTag[];
};

function callableTokens(item: Callable): Token[] {
  const head = name(item.name);

  if (item.tags?.includes("property")) {
    return item.returns === undefined
      ? [head]
      : [head, plain(": "), ...typeTokens(item.returns)];
  }

  const params =
    item.params === undefined
      ? []
      : [
          plain("("),
          ...item.params.flatMap((param, index) => [
            ...(index > 0 ? [plain(", ")] : []),
            ...paramTokens(param),
          ]),
          plain(")"),
        ];
  const returns =
    item.returns === undefined
      ? []
      : [plain(" → "), ...typeTokens(item.returns)];

  return [head, ...params, ...returns, ...tagTokens(item.tags)];
}

export function functionTokens(item: Callable): Token[] {
  return callableTokens(item);
}

export function methodTokens(item: ScanMethod): Token[] {
  return callableTokens(item);
}

export function fieldTokens(field: ScanField): Token[] {
  return field.type === undefined
    ? [name(field.name)]
    : [name(field.name), plain(": "), ...typeTokens(field.type)];
}

export function constantTokens(
  constant: string,
  value: string | undefined,
): Token[] {
  return value === undefined
    ? [name(constant)]
    : [name(constant), plain(" = "), ...valueTokens(value)];
}

export function typeAliasTokens(alias: string): Token[] {
  return [keyword("type"), plain(" "), name(alias)];
}

function listTokens(items: string[]): Token[] {
  return items.flatMap((item, index) => [
    ...(index > 0 ? [plain(", ")] : []),
    name(item),
  ]);
}

type Heritage = { tags: string[]; implemented: string[]; inherited: string[] };

function heritageTokens(heritage: Heritage): Token[] {
  return [
    ...heritage.tags.flatMap((tag) => [plain(" "), keyword(tag)]),
    ...(heritage.implemented.length > 0
      ? [
          plain(" "),
          keyword("implements"),
          plain(" "),
          ...listTokens(heritage.implemented),
        ]
      : []),
    ...(heritage.inherited.length > 0
      ? [
          plain(" "),
          keyword("extends"),
          plain(" "),
          ...listTokens(heritage.inherited),
        ]
      : []),
  ];
}

export function classHeadTokens(
  className: string,
  heritage: Heritage,
): Token[] {
  return [
    keyword("class"),
    plain(" "),
    name(className),
    ...heritageTokens(heritage),
  ];
}

export function interfaceHeadTokens(
  interfaceName: string,
  heritage: Heritage,
): Token[] {
  return [
    keyword("interface"),
    plain(" "),
    name(interfaceName),
    ...heritageTokens(heritage),
  ];
}
