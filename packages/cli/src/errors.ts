import { InvalidRequest, RequestRefused } from "@recognizer/core";

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

export function errorText(error: unknown): string {
  return error instanceof InputError
    ? error.messages.join("\n")
    : (error as Error).message;
}

export function asInputError<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof InvalidRequest) {
      throw new InputError(error.messages);
    }

    throw error;
  }
}

export function asRefusal<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof RequestRefused) {
      throw new Refusal(error.messages);
    }

    throw error;
  }
}
