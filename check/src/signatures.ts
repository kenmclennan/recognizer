import type { ScanField, ScanMember, ScanMethod, ScanParam } from "./scan.js";

type Tag = NonNullable<ScanMethod["tags"]>[number];

const SHOWN_TAGS: Tag[] = ["static", "classmethod", "abstract", "async"];

type Callable = {
  name: string;
  params?: ScanParam[];
  returns?: string;
  tags?: readonly string[];
};

function paramText(param: ScanParam): string {
  return param.type === undefined ? param.name : `${param.name}: ${param.type}`;
}

function callableSignature(item: Callable): string {
  if (item.tags?.includes("property")) {
    return item.returns === undefined
      ? item.name
      : `${item.name}: ${item.returns}`;
  }

  const params =
    item.params === undefined
      ? ""
      : `(${item.params.map(paramText).join(", ")})`;
  const returns = item.returns === undefined ? "" : ` → ${item.returns}`;
  const tags = SHOWN_TAGS.filter((tag) => item.tags?.includes(tag))
    .map((tag) => ` ${tag}`)
    .join("");

  return `${item.name}${params}${returns}${tags}`;
}

export function methodSignature(method: ScanMethod): string {
  return callableSignature(method);
}

export function fieldSignature(field: ScanField): string {
  return field.type === undefined ? field.name : `${field.name}: ${field.type}`;
}

export function memberSignature(member: ScanMember): string {
  if (member.kind === "function") {
    return callableSignature(member);
  }

  if (member.kind === "constant") {
    return member.value === undefined
      ? member.name
      : `${member.name} = ${member.value}`;
  }

  if (member.kind === "class" || member.kind === "interface") {
    return member.bases !== undefined && member.bases.length > 0
      ? `${member.name}(${member.bases.join(", ")})`
      : member.name;
  }

  if (member.kind === "type") {
    return `type ${member.name}`;
  }

  return member.name;
}
