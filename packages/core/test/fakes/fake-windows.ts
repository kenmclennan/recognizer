import {
  InvalidRequest,
  type WindowState,
  type Windows,
} from "../../src/index.js";

export class FakeWindows implements Windows {
  readonly states = new Map<string, WindowState>();

  stateOf(id: string): WindowState {
    const state = this.states.get(id);

    if (state === undefined) {
      throw new InvalidRequest([`no window ${id}`]);
    }

    return state;
  }
}
