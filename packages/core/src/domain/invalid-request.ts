export class InvalidRequest extends Error {
  readonly messages: string[];

  static is(error: unknown): error is InvalidRequest {
    return (
      error instanceof InvalidRequest ||
      (error instanceof Error && error.name === "InvalidRequest")
    );
  }

  constructor(messages: string[]) {
    super(messages.join("\n"));
    this.name = "InvalidRequest";
    this.messages = messages;
  }
}
