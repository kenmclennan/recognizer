import {
  InvalidRequest,
  type WindowState,
  type Windows,
} from "@recognizer/core";
import type { Io } from "../../cli.js";
import { InputError } from "../../errors.js";
import { windowOrFail } from "../../window-commands.js";

export class WindowsAdapter implements Windows {
  constructor(private readonly io: Io) {}

  stateOf(id: string): WindowState {
    try {
      return windowOrFail(this.io, id);
    } catch (error) {
      if (error instanceof InputError) {
        throw new InvalidRequest(error.messages);
      }

      throw error;
    }
  }
}
