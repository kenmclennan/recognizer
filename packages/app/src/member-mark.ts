export type MemberMarkWord =
  | "new"
  | "changes"
  | "removed"
  | "added"
  | "modified";

export type MemberIcon = "plus" | "delta" | "minus";

export type MemberMark = { word: MemberMarkWord; icon: MemberIcon };

export const PLAN_MEMBER_WORDS: MemberMarkWord[] = [
  "new",
  "changes",
  "removed",
];

export const CHANGE_MEMBER_WORDS: MemberMarkWord[] = [
  "added",
  "modified",
  "removed",
];

export function iconOf(word: MemberMarkWord): MemberIcon {
  switch (word) {
    case "new":
    case "added":
      return "plus";
    case "changes":
    case "modified":
      return "delta";
    case "removed":
      return "minus";
  }
}

export function memberMark(word: MemberMarkWord): MemberMark {
  return { word, icon: iconOf(word) };
}
