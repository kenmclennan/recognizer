export class InputError extends Error {
  readonly messages: string[];

  constructor(messages: string[]) {
    super(messages.join("\n"));
    this.name = "InputError";
    this.messages = messages;
  }
}
