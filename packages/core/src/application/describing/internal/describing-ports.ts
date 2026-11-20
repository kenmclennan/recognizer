import type { Clock } from "../../shared/ports/clock.js";
import type { Confirm } from "../ports/confirm.js";
import type { Describer } from "../ports/describer.js";

export interface DescribingPorts {
  describer: Describer;
  confirm: Confirm;
  clock: Clock;
}
