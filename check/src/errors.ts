export class InputError extends Error {
  readonly messages: string[];

  constructor(messages: string[]) {
    super(messages.join("\n"));
    this.name = "InputError";
    this.messages = messages;
  }
}

export class Refusal extends Error {
  readonly messages: string[];

  constructor(messages: string[]) {
    super(messages.join("\n"));
    this.name = "Refusal";
    this.messages = messages;
  }
}
