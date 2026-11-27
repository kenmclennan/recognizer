export interface AssistantText {
  name: string;
  program: string;
  account_note: string;
  signed_out_reason: string;
  signed_out_markers: string[];
  limit_markers: string[];
}

export const DEFAULT_ASSISTANT_TEXT: AssistantText = {
  name: "Assistant",
  program: "the assistant",
  account_note: "",
  signed_out_reason: "The assistant is not signed in.",
  signed_out_markers: [],
  limit_markers: [],
};

export function assistantTextOf(
  describers: readonly { name: string; assistant?: AssistantText }[],
): AssistantText | null {
  const publishers = describers
    .filter((describer) => describer.assistant !== undefined)
    .sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );

  return publishers[0]?.assistant ?? null;
}
