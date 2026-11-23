export class RequestRefused extends Error {
  readonly messages: string[];

  constructor(messages: string[]) {
    super(messages.join("\n"));
    this.name = "RequestRefused";
    this.messages = messages;
  }
}
