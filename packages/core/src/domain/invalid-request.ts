export class InvalidRequest extends Error {
  readonly messages: string[];

  constructor(messages: string[]) {
    super(messages.join("\n"));
    this.name = "InvalidRequest";
    this.messages = messages;
  }
}
