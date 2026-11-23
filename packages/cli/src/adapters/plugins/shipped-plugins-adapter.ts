import { type ShippedPlugins, shippedDescriberCommand } from "@recognizer/core";
import shipped from "../../generated/shipped-plugins.json" with {
  type: "json",
};

export class ShippedPluginsAdapter implements ShippedPlugins {
  sensors(): string[] {
    return [...shipped.sensors];
  }

  describers(): string[] {
    return [...shipped.describers];
  }

  scanners(): string[] {
    return [...shipped.scanners];
  }
}

const shared = new ShippedPluginsAdapter();

export function shippedPlugins(): ShippedPlugins {
  return shared;
}

export function shippedSensorNames(): string[] {
  return shared.sensors();
}

export function shippedDescriberName(): string {
  return shared.describers()[0] ?? "";
}

export function shippedDescriberInvocation(): string[] {
  return shippedDescriberCommand(shippedDescriberName());
}
